import type { Pool } from 'pg';
import pino from 'pino';
import { withSystem, writeAudit, enqueueEvent, finishEvidenceErasure } from '@credisync/db';
import { sendEmail } from '@credisync/notifications';
import { deleteUserFiles, deleteEvidenceObject } from '@credisync/storage';

const logger = pino({ name: 'jobs' });

/**
 * Retention periods. POPIA s14: keep personal information no longer than
 * needed for the purpose. Raw bank transactions feed affordability
 * analysis, for which ~2 years is ample; monthly snapshots are kept.
 * Superseded credit profiles older than 2 years are dropped unless a
 * dispute still references them. Audit trails keep a 5-year floor.
 * Confirm these periods with compliance before go-live.
 */
/** Unset means 24. Anything but a positive integer string throws (an empty or zero value would erase everything). */
export function parseEvidenceRetentionMonths(raw: string | undefined): number {
  if (raw === undefined) return 24;
  const n = Number(raw);
  if (!/^[1-9][0-9]*$/.test(raw) || !Number.isSafeInteger(n))
    throw new Error('EVIDENCE_RETENTION_MONTHS must be a positive integer number of months');
  return n;
}

export const RETENTION = {
  transactionMonths: Number(process.env.TRANSACTION_RETENTION_MONTHS ?? 24),
  supersededProfileMonths: Number(process.env.PROFILE_HISTORY_RETENTION_MONTHS ?? 24),
  auditLogYears: 5,
  /** Parsed on read so an invalid value cannot break unrelated jobs at import time. */
  get evidenceMonths(): number {
    return parseEvidenceRetentionMonths(process.env.EVIDENCE_RETENTION_MONTHS);
  },
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
    const events = await client.query(
      `DELETE FROM credisync.event_outbox WHERE published_at < NOW() - INTERVAL '7 days'`,
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
      publishedEvents: events.rowCount ?? 0,
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
      await enqueueEvent(client, {
        type: 'dispute.deadline_breached',
        aggregateType: 'dispute',
        aggregateId: row.id,
        userId: row.user_id,
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
        await enqueueEvent(client, {
          type: 'user.erased',
          aggregateType: 'user',
          aggregateId: request.user_id,
          userId: request.user_id,
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

const EVIDENCE_BATCH = 200;
const PENDING_WINDOW_HOURS = 24;
const DRAFT_IDLE_DAYS = 90;

/**
 * Marks one batch of evidence 'deleting' and writes the same data_deletion_request audit
 * event as the dispute engine's markEvidenceDeleting (this package cannot import the
 * engine). `picked` selects dispute_evidence ids, locking them with FOR UPDATE.
 * Short transaction; no storage calls.
 */
async function queueEvidenceBatch(pool: Pool, picked: string, params: unknown[]): Promise<number> {
  return withSystem(pool, async (client) => {
    const r = await client.query<{ id: string; user_id: string }>(
      `UPDATE credisync.dispute_evidence
       SET status = 'deleting', deletion_requested_at = NOW()
       WHERE id IN (${picked})
       RETURNING id, user_id`,
      params,
    );
    for (const row of r.rows) {
      await writeAudit(client, {
        userId: row.user_id,
        eventType: 'data_deletion_request',
        resourceType: 'dispute_evidence',
        resourceId: row.id,
        payload: { action: 'delete_evidence', evidence_id: row.id },
      });
    }
    return r.rows.length;
  });
}

/** Queued rows leave the selection, so this ends when a batch comes back short. */
async function queueAll(pool: Pool, picked: string, params: unknown[]): Promise<number> {
  let total = 0;
  for (;;) {
    const n = await queueEvidenceBatch(pool, picked, params);
    total += n;
    if (n < EVIDENCE_BATCH) return total;
  }
}

/**
 * Evidence maintenance: queues rows for erasure (expired pending uploads, evidence on
 * drafts idle 90 days, evidence past retention on resolved disputes), then attempts
 * erasure of every 'deleting' row via finishEvidenceErasure. Comparisons use database
 * time; `now` replaces NOW() in the queueing queries so tests are deterministic.
 *
 * expiredPending, staleDrafts and retained count rows newly queued. erased and failed
 * come from the erasure phase. waiting counts rows attempted but left 'deleting' because
 * an upload link may still be live (inside the margin): neither erased nor failed. Each
 * 'deleting' row is attempted once per run (keyset paging), so a persistent storage
 * failure cannot loop.
 */
export async function runEvidenceMaintenance(
  pool: Pool,
  now?: Date,
): Promise<{
  erased: number;
  failed: number;
  waiting: number;
  expiredPending: number;
  staleDrafts: number;
  retained: number;
}> {
  // Validate configuration before any queueing.
  const retentionMonths = RETENTION.evidenceMonths;
  const at = now ?? null;

  const expiredPending = await queueAll(
    pool,
    `SELECT e.id FROM credisync.dispute_evidence e
     WHERE e.status = 'pending'
       AND e.created_at + make_interval(hours => $2) <= COALESCE($1::timestamptz, NOW())
     ORDER BY e.id LIMIT ${EVIDENCE_BATCH} FOR UPDATE OF e SKIP LOCKED`,
    [at, PENDING_WINDOW_HOURS],
  );

  // The dispute row is locked too (as submit/escalate/upload do), so status and dates are
  // re-checked against committed data and a busy dispute waits for the next run.
  // Idle = the later of the draft's last change and its newest non-deleting upload.
  const staleDrafts = await queueAll(
    pool,
    `SELECT e.id FROM credisync.dispute_evidence e
     JOIN credisync.disputes d ON d.id = e.dispute_id
     WHERE e.status <> 'deleting' AND d.status = 'draft'
       AND GREATEST(d.updated_at, (
             SELECT max(x.created_at) FROM credisync.dispute_evidence x
             WHERE x.dispute_id = d.id AND x.status <> 'deleting'))
           <= COALESCE($1::timestamptz, NOW()) - make_interval(days => $2)
     ORDER BY e.id LIMIT ${EVIDENCE_BATCH} FOR UPDATE OF d, e SKIP LOCKED`,
    [at, DRAFT_IDLE_DAYS],
  );

  const retained = await queueAll(
    pool,
    `SELECT e.id FROM credisync.dispute_evidence e
     JOIN credisync.disputes d ON d.id = e.dispute_id
     WHERE e.status <> 'deleting'
       AND d.status IN ('resolved_upheld', 'resolved_rejected', 'escalated_ncr')
       AND COALESCE(d.ncr_escalated_at, d.resolved_at) IS NOT NULL
       AND COALESCE(d.ncr_escalated_at, d.resolved_at) + make_interval(months => $2)
           <= COALESCE($1::timestamptz, NOW())
     ORDER BY e.id LIMIT ${EVIDENCE_BATCH} FOR UPDATE OF d, e SKIP LOCKED`,
    [at, retentionMonths],
  );

  // Resolved disputes with no usable date keep their files; only a count is logged.
  const undated = await withSystem(pool, async (c) => {
    const r = await c.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM credisync.dispute_evidence e
       JOIN credisync.disputes d ON d.id = e.dispute_id
       WHERE e.status <> 'deleting'
         AND d.status IN ('resolved_upheld', 'resolved_rejected', 'escalated_ncr')
         AND d.ncr_escalated_at IS NULL AND d.resolved_at IS NULL`,
    );
    return r.rows[0]?.n ?? 0;
  });
  if (undated > 0) logger.warn({ undated }, 'evidence kept: resolved disputes without a date');

  let erased = 0;
  let failed = 0;
  let waiting = 0;
  let after = '00000000-0000-0000-0000-000000000000';
  for (;;) {
    const batch = await withSystem(pool, async (c) => {
      const r = await c.query<{ id: string; storage_key: string }>(
        `SELECT id, storage_key FROM credisync.dispute_evidence
         WHERE status = 'deleting' AND id > $1 ORDER BY id LIMIT ${EVIDENCE_BATCH}`,
        [after],
      );
      return r.rows;
    });
    if (batch.length === 0) break;
    after = batch[batch.length - 1]!.id;
    const res = await finishEvidenceErasure(pool, batch, deleteEvidenceObject);
    erased += res.erased.length;
    failed += res.failed.length;
    waiting += res.kept.length;
    if (batch.length < EVIDENCE_BATCH) break;
  }

  const summary = { erased, failed, waiting, expiredPending, staleDrafts, retained };
  logger.info(summary, 'evidence maintenance complete');
  return summary;
}
