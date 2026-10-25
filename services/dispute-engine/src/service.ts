import type { Pool, PoolClient } from 'pg';
import pino from 'pino';
import { withSystem, withUser, writeAudit } from '@credisync/db';
import { decryptFromBytes } from '@credisync/crypto';
import { maskSaIdNumber, type DisputeReason, type DisputeStatus } from '@credisync/types';
import { sendEmail } from '@credisync/notifications';
import { generateDisputeLetter } from './templates/dispute-letter.template';
import { assertLegalReviewComplete } from './templates/legal-references';
import { computeResolutionDeadline, southAfricanDate } from './deadlines';
import { InvalidTransitionError, isEditable, statusesLeadingTo } from './state-machine';
import type { AccountContext, DisputeRecord } from './types';

const logger = pino({ name: 'dispute-engine' });

export class DisputeError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'DisputeError';
  }
}

const notFound = () => new DisputeError(404, 'not_found', 'Dispute not found');

function toRecord(r: Record<string, unknown>): DisputeRecord {
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  const date = (v: unknown) => (v ? (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)) : null);
  return {
    id: r.id as string,
    userId: r.user_id as string,
    bureauAccountId: r.bureau_account_id as string,
    bureau: r.bureau as DisputeRecord['bureau'],
    disputeReason: r.dispute_reason as DisputeReason,
    disputeDescription: r.dispute_description as string,
    supportingEvidence: (r.supporting_evidence as string[]) ?? [],
    status: r.status as DisputeStatus,
    letterContent: (r.letter_content as string | null) ?? null,
    letterGeneratedAt: iso(r.letter_generated_at),
    letterVersion: Number(r.letter_version ?? 0),
    submittedAt: iso(r.submitted_at),
    submissionChannel: (r.submission_channel as string | null) ?? null,
    bureauReference: (r.bureau_reference as string | null) ?? null,
    bureauResponse: (r.bureau_response as string | null) ?? null,
    bureauRespondedAt: iso(r.bureau_responded_at),
    resolvedAt: iso(r.resolved_at),
    ncrCaseNumber: (r.ncr_case_number as string | null) ?? null,
    ncrEscalatedAt: iso(r.ncr_escalated_at),
    resolutionDeadline: date(r.resolution_deadline),
    deadlineBreachedAt: iso(r.deadline_breached_at),
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
    creditorName: (r.creditor_name as string | undefined) ?? undefined,
    accountType: (r.account_type as string | undefined) ?? undefined,
  };
}

const SELECT_DISPUTE = `
  SELECT d.*, ba.creditor_name, ba.account_type
  FROM credisync.disputes d
  JOIN credisync.bureau_accounts ba ON ba.id = d.bureau_account_id`;

/**
 * Atomic compare-and-set status change: the UPDATE only applies if the
 * dispute is currently in a status that may lead to `to`, so two
 * concurrent requests can never both succeed or skip a state.
 */
async function transition(
  client: PoolClient,
  id: string,
  to: DisputeStatus,
  extraSet: string,
  extraParams: unknown[],
  allowedFrom: DisputeStatus[] = statusesLeadingTo(to)
): Promise<DisputeRecord> {
  const result = await client.query(
    `UPDATE credisync.disputes SET status = $2${extraSet ? `, ${extraSet}` : ''}
     WHERE id = $1 AND status = ANY($3::credisync.dispute_status[])
     RETURNING *`,
    [id, to, allowedFrom, ...extraParams]
  );
  if (result.rows[0]) return toRecord(result.rows[0]);

  const current = await client.query<{ status: DisputeStatus }>('SELECT status FROM credisync.disputes WHERE id = $1', [id]);
  if (!current.rows[0]) throw notFound();
  throw new InvalidTransitionError(current.rows[0].status, to);
}

async function loadHolidayOverrides(client: PoolClient): Promise<Set<string>> {
  const r = await client.query<{ d: string }>(
    "SELECT to_char(holiday_date, 'YYYY-MM-DD') AS d FROM credisync.public_holiday_overrides WHERE holiday_date >= CURRENT_DATE - 1"
  );
  return new Set(r.rows.map((row) => row.d));
}

async function consumerContext(client: PoolClient, userId: string) {
  const r = await client.query(
    'SELECT first_name, last_name, mobile_number, email, sa_id_encrypted FROM credisync.users WHERE id = $1',
    [userId]
  );
  const u = r.rows[0];
  if (!u) throw new DisputeError(404, 'not_found', 'User not found');
  const saId = await decryptFromBytes(u.sa_id_encrypted);
  return {
    fullName: `${u.first_name} ${u.last_name}`,
    saIdMasked: maskSaIdNumber(saId),
    mobileNumber: u.mobile_number as string,
    email: u.email as string,
  };
}

async function accountContext(client: PoolClient, bureauAccountId: string): Promise<(AccountContext & { bureau: DisputeRecord['bureau'] }) | null> {
  const r = await client.query(
    `SELECT bureau, creditor_name, account_type, account_reference, current_balance, overdue_amount, status
     FROM credisync.bureau_accounts WHERE id = $1`,
    [bureauAccountId]
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    bureau: row.bureau,
    creditorName: row.creditor_name,
    accountType: row.account_type,
    accountReference: row.account_reference,
    currentBalance: Number(row.current_balance),
    overdueAmount: Number(row.overdue_amount),
    status: row.status,
  };
}

function assertEvidenceKeysBelongTo(userId: string, keys: string[]): void {
  const prefix = `uploads/${userId}/`;
  for (const key of keys) {
    if (!key.startsWith(prefix) || key.includes('..')) {
      throw new DisputeError(400, 'invalid_evidence', 'Evidence must be uploaded through CrediSync');
    }
  }
}

// ---------------------------------------------------------------------------
// Consumer actions (row-level security limits every query to the caller)
// ---------------------------------------------------------------------------

export async function listDisputes(pool: Pool, userId: string): Promise<DisputeRecord[]> {
  return withUser(pool, userId, async (client) => {
    const r = await client.query(`${SELECT_DISPUTE} WHERE d.user_id = $1 ORDER BY d.created_at DESC`, [userId]);
    return r.rows.map(toRecord);
  });
}

export async function getDispute(pool: Pool, userId: string, id: string): Promise<DisputeRecord> {
  return withUser(pool, userId, async (client) => {
    const r = await client.query(`${SELECT_DISPUTE} WHERE d.id = $1`, [id]);
    if (!r.rows[0]) throw notFound();
    return toRecord(r.rows[0]);
  });
}

export interface CreateDisputeInput {
  bureauAccountId: string;
  reason: DisputeReason;
  description: string;
  evidenceKeys: string[];
}

/** Creates a draft dispute and generates the letter for the consumer to review. */
export async function createDispute(pool: Pool, userId: string, input: CreateDisputeInput): Promise<DisputeRecord> {
  assertLegalReviewComplete();
  assertEvidenceKeysBelongTo(userId, input.evidenceKeys);

  return withUser(pool, userId, async (client) => {
    // RLS: returns nothing for another user's account.
    const account = await accountContext(client, input.bureauAccountId);
    if (!account) throw new DisputeError(404, 'account_not_found', 'That account is not on your credit profile');

    const open = await client.query(
      `SELECT 1 FROM credisync.disputes
       WHERE bureau_account_id = $1 AND status NOT IN ('resolved_upheld','resolved_rejected','escalated_ncr')`,
      [input.bureauAccountId]
    );
    if (open.rowCount) throw new DisputeError(409, 'dispute_already_open', 'There is already an open dispute for this account');

    const consumer = await consumerContext(client, userId);
    const letter = generateDisputeLetter({
      consumer,
      account,
      bureau: account.bureau,
      reason: input.reason,
      description: input.description,
      hasEvidence: input.evidenceKeys.length > 0,
    });

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO credisync.disputes (
         user_id, bureau_account_id, bureau, dispute_reason, dispute_description,
         supporting_evidence, status, letter_content, letter_generated_at, letter_version
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'draft', $7, NOW(), 1)
       RETURNING id`,
      [userId, input.bureauAccountId, account.bureau, input.reason, input.description, JSON.stringify(input.evidenceKeys), letter]
    );
    const id = inserted.rows[0]!.id;
    await writeAudit(client, { userId, eventType: 'dispute_created', resourceType: 'dispute', resourceId: id, payload: { reason: input.reason, bureau: account.bureau } });

    const r = await client.query(`${SELECT_DISPUTE} WHERE d.id = $1`, [id]);
    return toRecord(r.rows[0]!);
  });
}

export async function regenerateLetter(pool: Pool, userId: string, id: string, description: string): Promise<DisputeRecord> {
  assertLegalReviewComplete();
  return withUser(pool, userId, async (client) => {
    const r = await client.query(`${SELECT_DISPUTE} WHERE d.id = $1 FOR UPDATE OF d`, [id]);
    const existing = r.rows[0];
    if (!existing) throw notFound();
    if (!isEditable(existing.status)) {
      throw new DisputeError(409, 'not_editable', 'This dispute has already been sent and can no longer be edited');
    }
    const account = await accountContext(client, existing.bureau_account_id);
    const consumer = await consumerContext(client, userId);
    const letter = generateDisputeLetter({
      consumer,
      account: account!,
      bureau: existing.bureau,
      reason: existing.dispute_reason,
      description,
      hasEvidence: (existing.supporting_evidence as string[]).length > 0,
    });
    const updated = await client.query(
      `UPDATE credisync.disputes
       SET dispute_description = $2, letter_content = $3, letter_generated_at = NOW(), letter_version = letter_version + 1
       WHERE id = $1 RETURNING *`,
      [id, description, letter]
    );
    return toRecord({ ...updated.rows[0], creditor_name: existing.creditor_name, account_type: existing.account_type });
  });
}

export function submissionChannel(env: NodeJS.ProcessEnv = process.env): 'manual' | 'bureau_api' {
  return env.DISPUTE_SUBMISSION_CHANNEL === 'bureau_api' ? 'bureau_api' : 'manual';
}

/**
 * draft → submitted. Stamps the statutory response deadline. With the
 * 'manual' channel (default until bureau dispute APIs are contracted) the
 * operations team is notified to lodge the letter and records the bureau's
 * reference via the admin endpoint.
 */
export async function submitDispute(pool: Pool, userId: string, id: string): Promise<DisputeRecord> {
  const channel = submissionChannel();
  const record = await withUser(pool, userId, async (client) => {
    const holidays = await loadHolidayOverrides(client);
    const submittedAt = new Date();
    const deadline = computeResolutionDeadline(submittedAt, holidays);
    const updated = await transition(client, id, 'submitted', 'submitted_at = $4, resolution_deadline = $5, submission_channel = $6', [
      submittedAt,
      deadline,
      channel,
    ]);
    await writeAudit(client, {
      userId,
      eventType: 'dispute_submitted',
      resourceType: 'dispute',
      resourceId: id,
      payload: { channel, resolution_deadline: deadline },
    });
    return updated;
  });

  await notifySafely(pool, userId, 'Your dispute has been submitted', `Your dispute (${id}) has been submitted. The bureau must respond by ${record.resolutionDeadline}. We will keep you updated.`);
  if (channel === 'manual' && process.env.DISPUTES_OPS_EMAIL) {
    await sendEmail({
      to: process.env.DISPUTES_OPS_EMAIL,
      subject: `Dispute ${id} ready to lodge with ${record.bureau}`,
      body: `Dispute ${id} was submitted and must be lodged with ${record.bureau}. Response deadline: ${record.resolutionDeadline}.`,
    }).catch((err) => logger.error({ err, disputeId: id }, 'failed to notify operations'));
  }
  return record;
}

/**
 * Consumer escalation to the ombud / NCR. Allowed after a rejection, or
 * when the bureau has missed the statutory response deadline.
 */
export async function escalateDispute(pool: Pool, userId: string, id: string, caseNumber: string): Promise<DisputeRecord> {
  return withUser(pool, userId, async (client) => {
    const r = await client.query<{ status: DisputeStatus; resolution_deadline: Date | null }>(
      'SELECT status, resolution_deadline FROM credisync.disputes WHERE id = $1 FOR UPDATE',
      [id]
    );
    const d = r.rows[0];
    if (!d) throw notFound();

    const today = southAfricanDate(new Date()).toISOString().slice(0, 10);
    const deadline = d.resolution_deadline ? new Date(d.resolution_deadline).toISOString().slice(0, 10) : null;
    const deadlineMissed = deadline !== null && today > deadline;
    if ((d.status === 'submitted' || d.status === 'under_review') && !deadlineMissed) {
      throw new DisputeError(
        409,
        'deadline_not_passed',
        `The bureau has until ${deadline} to respond. You can escalate if it misses that date.`
      );
    }

    const updated = await transition(client, id, 'escalated_ncr', 'ncr_case_number = $4, ncr_escalated_at = NOW()', [caseNumber]);
    await writeAudit(client, { userId, eventType: 'dispute_escalated', resourceType: 'dispute', resourceId: id });
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Operations / bureau actions (system context, always attributed)
// ---------------------------------------------------------------------------

export async function recordBureauReference(pool: Pool, actorId: string, id: string, bureauReference: string): Promise<DisputeRecord> {
  return withSystem(pool, async (client) => {
    const r = await client.query(
      `UPDATE credisync.disputes SET bureau_reference = $2 WHERE id = $1 AND status IN ('submitted','under_review') RETURNING *`,
      [id, bureauReference]
    );
    if (!r.rows[0]) throw new DisputeError(409, 'not_submitted', 'Only submitted disputes can be given a bureau reference');
    await writeAudit(client, {
      userId: r.rows[0].user_id,
      performedBy: actorId,
      eventType: 'admin_access',
      resourceType: 'dispute',
      resourceId: id,
      payload: { action: 'record_bureau_reference' },
    });
    return toRecord(r.rows[0]);
  });
}

export async function recordBureauResponse(
  client: PoolClient,
  actorId: string | null,
  id: string,
  response: string,
  reference: string | null
): Promise<DisputeRecord> {
  const current = await client.query<{ status: DisputeStatus }>('SELECT status FROM credisync.disputes WHERE id = $1 FOR UPDATE', [id]);
  if (!current.rows[0]) throw notFound();

  // A second response while under review just updates the text.
  const updated =
    current.rows[0].status === 'under_review'
      ? toRecord(
          (
            await client.query(
              `UPDATE credisync.disputes SET bureau_response = $2, bureau_responded_at = NOW(),
                 bureau_reference = COALESCE($3, bureau_reference) WHERE id = $1 RETURNING *`,
              [id, response, reference]
            )
          ).rows[0]!
        )
      : await transition(client, id, 'under_review', 'bureau_response = $4, bureau_responded_at = NOW(), bureau_reference = COALESCE($5, bureau_reference)', [
          response,
          reference,
        ]);

  await writeAudit(client, {
    userId: updated.userId,
    performedBy: actorId,
    eventType: 'dispute_bureau_response',
    resourceType: 'dispute',
    resourceId: id,
  });
  return updated;
}

export async function resolveDispute(client: PoolClient, actorId: string | null, id: string, upheld: boolean): Promise<DisputeRecord> {
  const updated = await transition(client, id, upheld ? 'resolved_upheld' : 'resolved_rejected', 'resolved_at = NOW()', []);
  await writeAudit(client, {
    userId: updated.userId,
    performedBy: actorId,
    eventType: 'dispute_resolved',
    resourceType: 'dispute',
    resourceId: id,
    payload: { upheld },
  });
  return updated;
}

export async function adminRecordResponse(
  pool: Pool,
  actorId: string,
  id: string,
  input: { response: string; reference: string | null; resolution: 'upheld' | 'rejected' | null }
): Promise<DisputeRecord> {
  const record = await withSystem(pool, async (client) => {
    let r = await recordBureauResponse(client, actorId, id, input.response, input.reference);
    if (input.resolution) r = await resolveDispute(client, actorId, id, input.resolution === 'upheld');
    return r;
  });
  if (input.resolution) await notifyResolution(pool, record);
  return record;
}

export interface BureauWebhookEvent {
  eventId: string;
  disputeId: string;
  bureau: DisputeRecord['bureau'];
  response: string;
  reference: string | null;
  resolution: 'upheld' | 'rejected' | null;
}

/** Idempotent: a retried delivery with the same eventId is acknowledged and ignored. */
export async function handleBureauWebhook(pool: Pool, event: BureauWebhookEvent): Promise<{ duplicate: boolean }> {
  const outcome = await withSystem(pool, async (client) => {
    const owner = await client.query<{ bureau: string }>('SELECT bureau FROM credisync.disputes WHERE id = $1', [event.disputeId]);
    if (!owner.rows[0]) throw notFound();
    if (owner.rows[0].bureau !== event.bureau) {
      throw new DisputeError(403, 'bureau_mismatch', 'This dispute was not lodged with that bureau');
    }

    const fresh = await client.query(
      'INSERT INTO credisync.dispute_webhook_events (event_id, dispute_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING event_id',
      [event.eventId, event.disputeId]
    );
    if (!fresh.rowCount) return { duplicate: true, record: null };

    let record = await recordBureauResponse(client, null, event.disputeId, event.response, event.reference);
    if (event.resolution) record = await resolveDispute(client, null, event.disputeId, event.resolution === 'upheld');
    return { duplicate: false, record: event.resolution ? record : null };
  });
  if (outcome.record) await notifyResolution(pool, outcome.record);
  return { duplicate: outcome.duplicate };
}

async function notifyResolution(pool: Pool, record: DisputeRecord): Promise<void> {
  const upheld = record.status === 'resolved_upheld';
  await notifySafely(
    pool,
    record.userId,
    'Update on your credit dispute',
    upheld
      ? `Good news: the bureau upheld your dispute (${record.id}) and corrected the record.`
      : `The bureau rejected your dispute (${record.id}). You can escalate it from the CrediSync app.`
  );
}

async function notifySafely(pool: Pool, userId: string, subject: string, body: string): Promise<void> {
  try {
    const email = await withSystem(pool, async (c) => (await c.query('SELECT email FROM credisync.users WHERE id = $1', [userId])).rows[0]?.email);
    if (email) await sendEmail({ to: email, subject, body });
  } catch (err) {
    logger.error({ err }, 'failed to send dispute notification');
  }
}
