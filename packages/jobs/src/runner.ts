import { Pool } from 'pg';
import pino from 'pino';

const logger = pino({ name: 'jobs' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const RETENTION_PERIODS = {
  auditLogs: 5 * 365,
  transactions: 7 * 365,
  deletedAccounts: 90,
} as const;

export async function runRetentionCleanup(): Promise<Record<string, number>> {
  const results: Record<string, number> = {};

  const auditResult = await pool.query(
    `DELETE FROM credisync.regulatory_audit_logs WHERE created_at < NOW() - INTERVAL '${RETENTION_PERIODS.auditLogs} days'`
  );
  results.auditLogs = auditResult.rowCount ?? 0;

  const transactionResult = await pool.query(
    `DELETE FROM credisync.transactions WHERE transaction_date < NOW() - INTERVAL '${RETENTION_PERIODS.transactions} days'`
  );
  results.transactions = transactionResult.rowCount ?? 0;

  const deletedResult = await pool.query(
    `DELETE FROM credisync.users WHERE is_active = FALSE AND updated_at < NOW() - INTERVAL '${RETENTION_PERIODS.deletedAccounts} days'`
  );
  results.deletedAccounts = deletedResult.rowCount ?? 0;

  logger.info(results, 'retention cleanup complete');
  return results;
}

export async function runAuditLogArchival(): Promise<{ archived: number }> {
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 2);

  const result = await pool.query(
    `DELETE FROM credisync.regulatory_audit_logs WHERE created_at < $1 AND event_type NOT IN ('data_deletion_request', 'dispute_submitted') RETURNING id`,
    [cutoff]
  );

  const archived = result.rowCount ?? 0;
  logger.info({ archived }, 'audit log archival complete');
  return { archived };
}

async function main(): Promise<void> {
  const command = process.argv[2];

  try {
    switch (command) {
      case 'retention':
        await runRetentionCleanup();
        break;
      case 'archival':
        await runAuditLogArchival();
        break;
      case undefined:
        await runRetentionCleanup();
        await runAuditLogArchival();
        break;
      default:
        logger.error({ command }, 'unknown job command');
        process.exit(1);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  logger.error({ err }, 'job error');
  process.exit(1);
});
