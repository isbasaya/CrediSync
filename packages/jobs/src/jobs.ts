import type { Pool } from 'pg';
import pino from 'pino';
import { withSystem, writeAudit } from '@credisync/db';
import { sendEmail } from '@credisync/notifications';
import { deleteUserFiles } from '@credisync/storage';

const logger = pino({ name: 'jobs' });

/**
 * Retention periods. POPIA s14: keep personal information no longer than
 * needed for the purpose. Raw bank transactions feed affordability
 * analysis, for which ~2 years is ample; monthly snapshots are kept.
 * Superseded credit profiles older than 2 years are dropped unless a
 * dispute still references them. Audit trails keep a 5-year floor.
 * Confirm these periods with compliance before go-live.
 */
export const RETENTION = {
  transactionMonths: Number(process.env.TRANSACTION_RETENTION_MONTHS ?? 24),
  supersededProfileMonths: Number(process.env.PROFILE_HISTORY_RETENTION_MONTHS ?? 24),
  auditLogYears: 5,
} as const;

export async function runRetention(pool: Pool): Promise<Record<string, number>> {
  const results = await withSystem(pool, async (client) => {
    const tx = await client.query(
      `DELETE FROM credisync.transactions WHERE transaction_date < (CURRENT_DATE - make_interval(months => $1))`,
      [RETENTION.transactionMonths],
    );
    const profiles = await client.query(
      `DELETE FROM credisync.credit_profiles cp
       WHERE cp.is_current = FALSE
         AND cp.created_at < NOW() - make_interval(months => $1)
         AND NOT EXISTS (
           SELECT 1 FROM credisync.disputes d
           JOIN credisync.bureau_accounts ba ON ba.id = d.bureau_account_id
           WHERE ba.credit_profile_id = cp.id
         )`,
      [RETENTION.supersededProfileMonths],
    );
    const sessions = await client.query(
      `DELETE FROM credisync.user_sessions WHERE expires_at < NOW() - INTERVAL '7 days' OR revoked_at < NOW() - INTERVAL '30 days'`,
    );
    const tokens = await client.query(
      `DELETE FROM credisync.email_verification_tokens WHERE expires_at < NOW() - INTERVAL '7 days'`,
    );

    // The append-only trigger allows deleting audit rows only past the
    // 5-year floor and only when this setting is on for the transaction.
    await client.query("SELECT set_config('app.audit_retention_purge', 'on', true)");
    const audit = await client.query(
      `DELETE FROM credisync.regulatory_audit_logs WHERE created_at < NOW() - make_interval(years => $1)`,
      [RETENTION.auditLogYears],
    );

    return {
      transactions: tx.rowCount ?? 0,
      supersededProfiles: profiles.rowCount ?? 0,
      sessions: sessions.rowCount ?? 0,
      verificationTokens: tokens.rowCount ?? 0,
      auditLogs: audit.rowCount ?? 0,
    };
  });
  logger.info(results, 'retention complete');
  return results;
}

/** Makes sure the next two years of transaction partitions exist before they're needed. */
export async function runPartitionMaintenance(pool: Pool, now = new Date()): Promise<string[]> {
  const year = now.getUTCFullYear();
  const created = await withSystem(pool, async (client) => {
    const names: string[] = [];
    for (const y of [year, year + 1, year + 2]) {
      const r = await client.query<{ name: string }>(
        'SELECT credisync.ensure_transactions_partition($1) AS name',
        [y],
      );
      names.push(r.rows[0]!.name);
    }
    const stray = await client.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM credisync.transactions_default',
    );
    if ((stray.rows[0]?.n ?? 0) > 0)
      logger.warn(
        { rows: stray.rows[0]!.n },
        'rows in transactions_default; add a partition for their years',
      );
    return names;
  });
  logger.info({ partitions: created }, 'partition maintenance complete');
  return created;
}

/** Flags disputes whose bureau response deadline (SAST calendar) has passed, and tells the consumer. */
export async function runDisputeDeadlineMonitor(pool: Pool): Promise<number> {
  const breached = await withSystem(pool, async (client) => {
    const r = await client.query<{
      id: string;
      user_id: string;
      email: string;
      bureau: string;
      resolution_deadline: string;
    }>(
      `UPDATE credisync.disputes d SET deadline_breached_at = NOW()
       FROM credisync.users u
       WHERE u.id = d.user_id
         AND d.status IN ('submitted', 'under_review')
         AND d.deadline_breached_at IS NULL
         AND d.resolution_deadline < (NOW() AT TIME ZONE 'Africa/Johannesburg')::date
       RETURNING d.id, d.user_id, u.email, d.bureau, to_char(d.resolution_deadline, 'YYYY-MM-DD') AS resolution_deadline`,
    );
    for (const row of r.rows) {
      await writeAudit(client, {
        userId: row.user_id,
        eventType: 'dispute_deadline_breached',
        resourceType: 'dispute',
        resourceId: row.id,
        payload: { bureau: row.bureau, deadline: row.resolution_deadline },
      });
    }
    return r.rows;
  });

  for (const row of breached) {
    await sendEmail({
      to: row.email,
      subject: 'The bureau missed its deadline on your dispute',
      body: `The bureau did not respond to your dispute (${row.id}) by ${row.resolution_deadline}. You can now escalate it from the CrediSync app.`,
    }).catch((err) => logger.error({ err, disputeId: row.id }, 'failed to send deadline notice'));
  }
  logger.info({ breached: breached.length }, 'dispute deadline monitor complete');
  return breached.length;
}

/** POPIA s24 erasure: deletes users whose grace period has ended, plus their uploaded files. */
export async function runDeletionRequests(pool: Pool): Promise<number> {
  const due = await withSystem(pool, async (client) => {
    const r = await client.query<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM credisync.data_deletion_requests
       WHERE completed_at IS NULL AND cancelled_at IS NULL AND scheduled_for <= NOW()
       ORDER BY scheduled_for LIMIT 100`,
    );
    return r.rows;
  });

  let completed = 0;
  for (const request of due) {
    try {
      // Files first: if this fails the user row still exists and the job retries next run.
      await deleteUserFiles(request.user_id);
      await withSystem(pool, async (client) => {
        await client.query('DELETE FROM credisync.users WHERE id = $1', [request.user_id]);
        await client.query(
          'UPDATE credisync.data_deletion_requests SET completed_at = NOW() WHERE id = $1',
          [request.id],
        );
        await writeAudit(client, {
          userId: request.user_id,
          eventType: 'data_deletion_completed',
          resourceType: 'user',
          resourceId: request.user_id,
        });
      });
      completed += 1;
    } catch (err) {
      logger.error({ err, requestId: request.id }, 'deletion request failed; will retry');
    }
  }
  logger.info({ completed, due: due.length }, 'deletion requests processed');
  return completed;
}
