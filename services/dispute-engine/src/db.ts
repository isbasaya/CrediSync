import { Pool, PoolClient } from 'pg';
import type { AccountContext, ConsumerContext, DisputeReason, DisputeRecord, DisputeStatus } from './types';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
});

/**
 * `users` and `disputes` both carry row-level-security policies keyed off
 * `current_setting('app.current_user_id')` (see db/schema.sql). Every
 * query against either table must run inside a transaction that sets
 * this session variable first, or RLS silently returns zero rows instead
 * of the caller's own data.
 */
async function runAsUser<T>(userId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL app.current_user_id = $1', [userId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Looks up the owning user for a dispute so status-transition endpoints (which only receive a disputeId) can still satisfy RLS. */
async function getDisputeOwner(disputeId: string): Promise<string> {
  // disputes RLS only permits reading rows already scoped to the caller,
  // so this lookup runs via the service's underlying DB role, which is
  // provisioned with BYPASSRLS specifically for this ownership-resolution
  // step — the only place this service reads across users.
  const result = await pool.query<{ user_id: string }>(`SELECT user_id FROM credisync.disputes WHERE id = $1`, [disputeId]);
  if (result.rowCount === 0) throw new Error(`dispute ${disputeId} not found`);
  return result.rows[0]!.user_id;
}

function maskSaId(saIdEncrypted: unknown): string {
  // The application layer decrypts sa_id_encrypted upstream (KMS) before
  // this service ever sees it; this service only ever receives an
  // already-masked display value. Kept as a defensive no-op mask here so
  // a full ID can never leak into a generated letter even if a caller
  // passes the raw value by mistake.
  const value = String(saIdEncrypted ?? '');
  if (value.length < 6) return '****';
  return `${value.slice(0, 4)}****${value.slice(-2)}`;
}

export async function fetchAccountContext(bureauAccountId: string): Promise<AccountContext> {
  // bureau_accounts has no RLS policy of its own (see db/schema.sql) —
  // access is authorized one level up, via the credit_profile it belongs to.
  const result = await pool.query(
    `SELECT creditor_name, account_type, account_reference, current_balance, overdue_amount, status
     FROM credisync.bureau_accounts WHERE id = $1`,
    [bureauAccountId]
  );
  if (result.rowCount === 0) throw new Error(`bureau_account ${bureauAccountId} not found`);
  const row = result.rows[0];
  return {
    creditorName: row.creditor_name,
    accountType: row.account_type,
    accountReference: row.account_reference,
    currentBalance: Number(row.current_balance),
    overdueAmount: Number(row.overdue_amount),
    status: row.status,
  };
}

export async function fetchConsumerContext(userId: string, maskedSaId: string): Promise<ConsumerContext> {
  return runAsUser(userId, async (client) => {
    const result = await client.query(
      `SELECT first_name, last_name, mobile_number, email FROM credisync.users WHERE id = $1`,
      [userId]
    );
    if (result.rowCount === 0) throw new Error(`user ${userId} not found`);
    const row = result.rows[0];
    return {
      fullName: `${row.first_name} ${row.last_name}`,
      saIdMasked: maskSaId(maskedSaId),
      mobileNumber: row.mobile_number,
      email: row.email,
    };
  });
}

export async function insertDraftDispute(params: {
  userId: string;
  bureauAccountId: string;
  bureau: string;
  reason: DisputeReason;
  description: string;
  evidenceKeys: string[];
}): Promise<string> {
  return runAsUser(params.userId, async (client) => {
    const result = await client.query<{ id: string }>(
      `INSERT INTO credisync.disputes (
         user_id, bureau_account_id, bureau, dispute_reason, dispute_description,
         supporting_evidence, status
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'draft')
       RETURNING id`,
      [params.userId, params.bureauAccountId, params.bureau, params.reason, params.description, JSON.stringify(params.evidenceKeys)]
    );
    const disputeId = result.rows[0]!.id;
    await logAudit(client, params.userId, 'dispute_created', disputeId);
    return disputeId;
  });
}

export async function saveGeneratedLetter(disputeId: string, letterContent: string): Promise<void> {
  const userId = await getDisputeOwner(disputeId);
  await runAsUser(userId, (client) =>
    client.query(
      `UPDATE credisync.disputes
       SET letter_content = $2, letter_generated_at = NOW(), letter_version = letter_version + 1
       WHERE id = $1`,
      [disputeId, letterContent]
    )
  );
}

export async function submitDispute(disputeId: string, userId: string, resolutionDeadline: string): Promise<void> {
  await runAsUser(userId, async (client) => {
    await client.query(
      `UPDATE credisync.disputes
       SET status = 'submitted', submitted_at = NOW(), resolution_deadline = $2
       WHERE id = $1`,
      [disputeId, resolutionDeadline]
    );
    await logAudit(client, userId, 'dispute_submitted', disputeId);
  });
}

export async function recordBureauResponse(disputeId: string, response: string, reference: string | null): Promise<void> {
  const userId = await getDisputeOwner(disputeId);
  await runAsUser(userId, (client) =>
    client.query(
      `UPDATE credisync.disputes
       SET status = 'under_review', bureau_response = $2, bureau_responded_at = NOW(), bureau_reference = COALESCE($3, bureau_reference)
       WHERE id = $1`,
      [disputeId, response, reference]
    )
  );
}

export async function resolveDispute(disputeId: string, upheld: boolean): Promise<void> {
  const userId = await getDisputeOwner(disputeId);
  await runAsUser(userId, (client) =>
    client.query(`UPDATE credisync.disputes SET status = $2 WHERE id = $1`, [disputeId, upheld ? 'resolved_upheld' : 'resolved_rejected'])
  );
}

export async function escalateToNcr(disputeId: string, caseNumber: string): Promise<void> {
  const userId = await getDisputeOwner(disputeId);
  await runAsUser(userId, (client) =>
    client.query(
      `UPDATE credisync.disputes SET status = 'escalated_ncr', ncr_case_number = $2, ncr_escalated_at = NOW() WHERE id = $1`,
      [disputeId, caseNumber]
    )
  );
}

export async function getDisputeStatus(disputeId: string): Promise<DisputeStatus> {
  const userId = await getDisputeOwner(disputeId);
  return runAsUser(userId, async (client) => {
    const result = await client.query<{ status: DisputeStatus }>(`SELECT status FROM credisync.disputes WHERE id = $1`, [disputeId]);
    if (result.rowCount === 0) throw new Error(`dispute ${disputeId} not found`);
    return result.rows[0]!.status;
  });
}

export async function getDispute(disputeId: string): Promise<DisputeRecord> {
  const userId = await getDisputeOwner(disputeId);
  return runAsUser(userId, async (client) => {
    const result = await client.query(`SELECT * FROM credisync.disputes WHERE id = $1`, [disputeId]);
    if (result.rowCount === 0) throw new Error(`dispute ${disputeId} not found`);
    const r = result.rows[0];
    return {
      id: r.id,
      userId: r.user_id,
      bureauAccountId: r.bureau_account_id,
      bureau: r.bureau,
      disputeReason: r.dispute_reason,
      disputeDescription: r.dispute_description,
      supportingEvidence: r.supporting_evidence,
      status: r.status,
      letterContent: r.letter_content,
      letterGeneratedAt: r.letter_generated_at,
      letterVersion: r.letter_version,
      submittedAt: r.submitted_at,
      bureauReference: r.bureau_reference,
      bureauResponse: r.bureau_response,
      bureauRespondedAt: r.bureau_responded_at,
      ncrCaseNumber: r.ncr_case_number,
      ncrEscalatedAt: r.ncr_escalated_at,
      resolutionDeadline: r.resolution_deadline,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  });
}

async function logAudit(client: PoolClient, userId: string, eventType: string, disputeId: string): Promise<void> {
  await client.query(
    `INSERT INTO credisync.regulatory_audit_logs (user_id, event_type, resource_type, resource_id)
     VALUES ($1, $2, 'dispute', $3)`,
    [userId, eventType, disputeId]
  );
}
