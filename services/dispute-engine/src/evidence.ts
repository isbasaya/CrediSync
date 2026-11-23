import type { Pool, PoolClient } from 'pg';
import pino from 'pino';
import { withSystem, withUser, writeAudit } from '@credisync/db';
import type { DisputeEvidence } from '@credisync/types';
import {
  createEvidenceDownloadUrl,
  createEvidenceRetryUpload,
  createEvidenceUpload,
  deleteEvidenceObject,
  sanitizeDisplayName,
  verifyEvidenceObject,
  type EvidenceVerification,
} from '@credisync/storage';
import { generateDisputeLetter } from './templates/dispute-letter.template';
import {
  DisputeError,
  SELECT_DISPUTE,
  accountContext,
  consumerContext,
  notFound,
  toRecord,
} from './shared';
import type { DisputeRecord } from './types';

const logger = pino({ name: 'dispute-evidence' });

export const MAX_EVIDENCE_FILES = 10;
/** A pending upload must be completed within this window of its creation. */
const UPLOAD_WINDOW_HOURS = 24;
const MAX_LINK_SECONDS = 15 * 60;

const uploadExpired = () =>
  new DisputeError(
    410,
    'evidence_upload_expired',
    'This upload has expired. Please add the file again.',
  );

type Row = Record<string, unknown>;

const notEditable = () =>
  new DisputeError(
    409,
    'not_editable',
    'This dispute has already been sent and can no longer be changed',
  );

function toEvidence(r: Row): DisputeEvidence {
  return {
    id: r.id as string,
    displayName: r.display_name as string,
    contentType: r.content_type as string,
    sizeBytes: Number(r.size_bytes),
    status: r.status as DisputeEvidence['status'],
  };
}

/** Files the owner can see: pending and verified, never those queued for deletion. */
export async function listEvidence(
  client: PoolClient,
  disputeId: string,
): Promise<DisputeEvidence[]> {
  const r = await client.query(
    `SELECT id, display_name, content_type, size_bytes, status
     FROM credisync.dispute_evidence
     WHERE dispute_id = $1 AND status <> 'deleting'
     ORDER BY created_at, id`,
    [disputeId],
  );
  return r.rows.map(toEvidence);
}

/** Evidence for several disputes at once, keyed by dispute id. */
export async function listEvidenceFor(
  client: PoolClient,
  disputeIds: string[],
): Promise<Map<string, DisputeEvidence[]>> {
  const byDispute = new Map<string, DisputeEvidence[]>();
  if (disputeIds.length === 0) return byDispute;
  const r = await client.query(
    `SELECT id, dispute_id, display_name, content_type, size_bytes, status
     FROM credisync.dispute_evidence
     WHERE dispute_id = ANY($1::uuid[]) AND status <> 'deleting'
     ORDER BY created_at, id`,
    [disputeIds],
  );
  for (const row of r.rows) {
    const list = byDispute.get(row.dispute_id as string) ?? [];
    list.push(toEvidence(row));
    byDispute.set(row.dispute_id as string, list);
  }
  return byDispute;
}

export async function hasVerifiedEvidence(client: PoolClient, disputeId: string): Promise<boolean> {
  const r = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM credisync.dispute_evidence WHERE dispute_id = $1 AND status = 'verified'
     ) AS yes`,
    [disputeId],
  );
  return r.rows[0]!.yes as boolean;
}

/**
 * Regenerates a draft's letter, and bumps `letter_version`, only when the
 * letter's evidence wording no longer matches whether a verified file exists.
 * `row` is a SELECT_DISPUTE row the caller holds locked FOR UPDATE.
 */
export async function syncDraftLetter(client: PoolClient, row: Row): Promise<Row> {
  if (row.status !== 'draft') return row;
  const id = row.id as string;
  const hasEvidence = await hasVerifiedEvidence(client, id);
  if (hasEvidence === Boolean(row.letter_has_evidence)) return row;

  const account = await accountContext(client, row.bureau_account_id as string);
  const consumer = await consumerContext(client, row.user_id as string);
  const letter = generateDisputeLetter({
    consumer,
    account: account!,
    bureau: row.bureau as never,
    reason: row.dispute_reason as never,
    description: row.dispute_description as string,
    hasEvidence,
  });
  const updated = await client.query(
    `UPDATE credisync.disputes
     SET letter_content = $2, letter_generated_at = NOW(),
         letter_version = letter_version + 1, letter_has_evidence = $3
     WHERE id = $1 RETURNING *`,
    [id, letter, hasEvidence],
  );
  return {
    ...updated.rows[0],
    creditor_name: row.creditor_name,
    account_type: row.account_type,
  };
}

// ---------------------------------------------------------------------------
// Two-phase deletion: mark inside the transaction, erase after commit
// ---------------------------------------------------------------------------

export type EvidenceScope = { disputeId: string } | { evidenceId: string };

/**
 * Queues files for deletion in the caller's transaction and writes the audit
 * record for each one newly queued. Returns the rows to pass to eraseMarked
 * after the transaction commits.
 */
export async function markEvidenceDeleting(
  client: PoolClient,
  where: EvidenceScope,
): Promise<Array<{ id: string; storage_key: string }>> {
  const column = 'disputeId' in where ? 'dispute_id' : 'id';
  const value = 'disputeId' in where ? where.disputeId : where.evidenceId;
  const r = await client.query<{ id: string; storage_key: string; user_id: string }>(
    `UPDATE credisync.dispute_evidence
     SET status = 'deleting', deletion_requested_at = NOW()
     WHERE ${column} = $1 AND status <> 'deleting'
     RETURNING id, storage_key, user_id`,
    [value],
  );
  for (const row of r.rows) {
    await writeAudit(client, {
      userId: row.user_id,
      eventType: 'data_deletion_completed',
      resourceType: 'dispute_evidence',
      resourceId: row.id,
      payload: { action: 'delete_evidence', evidence_id: row.id },
    });
  }
  return r.rows.map((row) => ({ id: row.id, storage_key: row.storage_key }));
}

/**
 * Deletes the object, then the row once its upload link has expired. Never throws: a
 * failure, or a link that may still be live, leaves the row 'deleting' so the scheduled
 * job deletes the object again later. Logs only the evidence id.
 */
export async function eraseMarked(
  pool: Pool,
  rows: Array<{ id: string; storage_key: string }>,
): Promise<void> {
  for (const row of rows) {
    try {
      // Always attempt the delete. The row (our only handle on the object) goes only once
      // no issued upload link can still recreate the object; until then the job retries.
      await deleteEvidenceObject(row.storage_key);
      await withSystem(pool, (c) =>
        c.query(
          `DELETE FROM credisync.dispute_evidence
           WHERE id = $1 AND status = 'deleting' AND upload_url_expires_at <= NOW()`,
          [row.id],
        ),
      );
    } catch (err) {
      logger.warn(
        { evidenceId: row.id, errorName: err instanceof Error ? err.name : 'unknown' },
        'evidence erase failed; left for retry',
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Upload and completion
// ---------------------------------------------------------------------------

export async function requestEvidenceUpload(
  pool: Pool,
  userId: string,
  disputeId: string,
  input: { contentType: string; contentLength: number; fileName: string },
): Promise<{
  evidence: DisputeEvidence;
  uploadUrl: string;
  requiredHeaders: Record<string, string>;
  expiresIn: number;
}> {
  // Validates type and size and presigns locally (no network), before any lock is taken.
  const presigned = await createEvidenceUpload(userId, input.contentType, input.contentLength);

  return withUser(pool, userId, async (client) => {
    const d = await client.query<{ status: string }>(
      'SELECT status FROM credisync.disputes WHERE id = $1 FOR UPDATE',
      [disputeId],
    );
    if (!d.rows[0]) throw notFound();
    if (d.rows[0].status !== 'draft') throw notEditable();

    const count = await client.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM credisync.dispute_evidence WHERE dispute_id = $1 AND status <> 'deleting'",
      [disputeId],
    );
    if (count.rows[0]!.n >= MAX_EVIDENCE_FILES) {
      throw new DisputeError(
        409,
        'evidence_limit',
        `You can attach up to ${MAX_EVIDENCE_FILES} files to a dispute`,
      );
    }

    const inserted = await client.query(
      `INSERT INTO credisync.dispute_evidence
         (user_id, dispute_id, storage_key, content_type, size_bytes, display_name, upload_url_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW() + $7 * interval '1 second')
       RETURNING id, display_name, content_type, size_bytes, status`,
      [
        userId,
        disputeId,
        presigned.key,
        input.contentType,
        input.contentLength,
        sanitizeDisplayName(input.fileName),
        presigned.expiresIn,
      ],
    );
    return {
      evidence: toEvidence(inserted.rows[0]!),
      uploadUrl: presigned.uploadUrl,
      requiredHeaders: presigned.requiredHeaders,
      expiresIn: presigned.expiresIn,
    };
  });
}

const FAILURE_MESSAGES: Record<
  Exclude<Extract<EvidenceVerification, { ok: false }>['reason'], 'missing'>,
  string
> = {
  too_large: 'That file is too large. Files must be smaller than 10 MB.',
  type_mismatch: 'That file is not a valid PDF, JPEG or PNG. Please choose a different file.',
};

type Outcome =
  | { kind: 'done'; record: DisputeRecord }
  | { kind: 'not_uploaded' }
  | {
      kind: 'refused';
      reason: 'not_draft' | 'invalid' | 'expired';
      erase: Array<{ id: string; storage_key: string }>;
    };

async function loadRecord(client: PoolClient, locked: Row): Promise<DisputeRecord> {
  return toRecord(locked, await listEvidence(client, locked.id as string));
}

export async function completeEvidenceUpload(
  pool: Pool,
  userId: string,
  disputeId: string,
  evidenceId: string,
): Promise<DisputeRecord> {
  // Phase 1: a short read, no lock held.
  const first = await withUser(pool, userId, async (client) => {
    const r = await client.query<{
      status: string;
      storage_key: string;
      content_type: string;
    }>(
      `SELECT status, storage_key, content_type FROM credisync.dispute_evidence
       WHERE id = $1 AND dispute_id = $2`,
      [evidenceId, disputeId],
    );
    return r.rows[0] ?? null;
  });
  if (!first || first.status === 'deleting') throw notFound();

  // Phase 2: verification reaches S3, so no transaction or lock is open.
  const verification: EvidenceVerification | null =
    first.status === 'pending'
      ? await verifyEvidenceObject(first.storage_key, first.content_type)
      : null;

  // Phase 3: re-lock the dispute, re-check, then apply the result.
  const outcome = await withUser(pool, userId, async (client): Promise<Outcome> => {
    const d = await client.query(`${SELECT_DISPUTE} WHERE d.id = $1 FOR UPDATE OF d`, [disputeId]);
    const dispute = d.rows[0];
    if (!dispute) throw notFound();

    const e = await client.query<{ status: string; expired: boolean }>(
      `SELECT status, created_at + interval '${UPLOAD_WINDOW_HOURS} hours' <= NOW() AS expired
       FROM credisync.dispute_evidence WHERE id = $1 AND dispute_id = $2 FOR UPDATE`,
      [evidenceId, disputeId],
    );
    const current = e.rows[0];
    if (!current || current.status === 'deleting') throw notFound();

    // Already verified (a repeat or concurrent completion): success, no letter change.
    if (current.status === 'verified') {
      return { kind: 'done', record: await loadRecord(client, dispute) };
    }

    if (current.expired) {
      return {
        kind: 'refused',
        reason: 'expired',
        erase: await markEvidenceDeleting(client, { evidenceId }),
      };
    }

    const missing =
      dispute.status === 'draft' && verification?.ok === false && verification.reason === 'missing';
    // An interrupted or expired upload stays pending so the user can retry or remove it.
    if (missing) return { kind: 'not_uploaded' };

    if (dispute.status !== 'draft' || !verification || !verification.ok) {
      return {
        kind: 'refused',
        reason: dispute.status !== 'draft' ? 'not_draft' : 'invalid',
        erase: await markEvidenceDeleting(client, { evidenceId }),
      };
    }

    await client.query(
      `UPDATE credisync.dispute_evidence
       SET status = 'verified', size_bytes = $2, verified_at = NOW()
       WHERE id = $1`,
      [evidenceId, verification.size],
    );
    const synced = await syncDraftLetter(client, dispute);
    return { kind: 'done', record: await loadRecord(client, synced) };
  });

  if (outcome.kind === 'done') return outcome.record;
  if (outcome.kind === 'not_uploaded') {
    throw new DisputeError(
      409,
      'evidence_not_uploaded',
      "We haven't received this file yet. Try uploading it again.",
    );
  }

  await eraseMarked(pool, outcome.erase);
  if (outcome.reason === 'expired') throw uploadExpired();
  if (outcome.reason === 'invalid' && verification && !verification.ok) {
    throw new DisputeError(
      400,
      'invalid_evidence',
      FAILURE_MESSAGES[verification.reason as 'too_large' | 'type_mismatch'],
    );
  }
  throw notEditable();
}

/** A fresh upload link for a pending file on a draft, because the first link may have expired. */
export async function retryEvidenceUpload(
  pool: Pool,
  userId: string,
  disputeId: string,
  evidenceId: string,
): Promise<{
  evidence: DisputeEvidence;
  uploadUrl: string;
  requiredHeaders: Record<string, string>;
  expiresIn: number;
}> {
  const found = await withUser(pool, userId, async (client) => {
    const d = await client.query<{ status: string }>(
      'SELECT status FROM credisync.disputes WHERE id = $1',
      [disputeId],
    );
    if (!d.rows[0]) throw notFound();
    const e = await client.query(
      `SELECT id, display_name, content_type, size_bytes, status, storage_key,
              floor(extract(epoch FROM created_at + interval '${UPLOAD_WINDOW_HOURS} hours' - NOW()))::int AS remaining
       FROM credisync.dispute_evidence WHERE id = $1 AND dispute_id = $2`,
      [evidenceId, disputeId],
    );
    const row = e.rows[0];
    if (!row || row.status === 'deleting') throw notFound();
    if (d.rows[0].status !== 'draft') throw notEditable();
    if (row.status !== 'pending') {
      throw new DisputeError(409, 'not_pending', 'This file has already been uploaded');
    }
    return row;
  });

  if ((found.remaining as number) <= 0) {
    // Past its window: queue, erase, and report. Re-check under lock so a race cannot erase a live row.
    const erase = await withUser(pool, userId, async (client) => {
      const d = await client.query<{ status: string }>(
        'SELECT status FROM credisync.disputes WHERE id = $1 FOR UPDATE',
        [disputeId],
      );
      if (!d.rows[0]) throw notFound();
      const e = await client.query<{ status: string }>(
        `SELECT status FROM credisync.dispute_evidence WHERE id = $1 AND dispute_id = $2 FOR UPDATE`,
        [evidenceId, disputeId],
      );
      const current = e.rows[0];
      if (!current || current.status === 'deleting') throw notFound();
      if (d.rows[0].status !== 'draft') throw notEditable();
      // A completion may have verified the file at the exact boundary: never queue that row.
      // created_at never changes, so a still-pending row is still past its window.
      if (current.status !== 'pending') {
        throw new DisputeError(409, 'not_pending', 'This file has already been uploaded');
      }
      return markEvidenceDeleting(client, { evidenceId });
    });
    await eraseMarked(pool, erase);
    throw uploadExpired();
  }

  // The link never outlives the row's 24-hour window.
  const expiresIn = Math.min(MAX_LINK_SECONDS, found.remaining as number);
  const presigned = await createEvidenceRetryUpload(
    found.storage_key as string,
    found.content_type as string,
    Number(found.size_bytes),
    expiresIn,
  );
  // Recorded after signing, so the stored time is never earlier than the link's real expiry.
  const recorded = await withUser(pool, userId, (client) =>
    client.query(
      `UPDATE credisync.dispute_evidence
       SET upload_url_expires_at = GREATEST(upload_url_expires_at, NOW() + $2 * interval '1 second')
       WHERE id = $1 AND status = 'pending'`,
      [evidenceId, presigned.expiresIn],
    ),
  );
  if (!recorded.rowCount) throw notFound();
  return {
    evidence: toEvidence(found),
    uploadUrl: presigned.uploadUrl,
    requiredHeaders: presigned.requiredHeaders,
    expiresIn: presigned.expiresIn,
  };
}

// ---------------------------------------------------------------------------
// Removal and downloads
// ---------------------------------------------------------------------------

/** Removes one file from a draft: queue, resync the letter, commit, then erase. */
export async function removeEvidence(
  pool: Pool,
  userId: string,
  disputeId: string,
  evidenceId: string,
): Promise<DisputeRecord> {
  const { record, erase } = await withUser(pool, userId, async (client) => {
    const d = await client.query(`${SELECT_DISPUTE} WHERE d.id = $1 FOR UPDATE OF d`, [disputeId]);
    const dispute = d.rows[0];
    if (!dispute) throw notFound();
    if (dispute.status !== 'draft') throw notEditable();

    const e = await client.query(
      `SELECT 1 FROM credisync.dispute_evidence
       WHERE id = $1 AND dispute_id = $2 AND status <> 'deleting'`,
      [evidenceId, disputeId],
    );
    if (!e.rowCount) throw evidenceNotFound();

    const marked = await markEvidenceDeleting(client, { evidenceId });
    const synced = await syncDraftLetter(client, dispute);
    return { record: await loadRecord(client, synced), erase: marked };
  });
  await eraseMarked(pool, erase);
  return record;
}

const evidenceNotFound = () => new DisputeError(404, 'not_found', 'Evidence not found');

/** A short-lived download link for a verified file; the owner's access is audited as data_access. */
export async function evidenceDownloadUrl(
  pool: Pool,
  userId: string,
  disputeId: string,
  evidenceId: string,
): Promise<{ url: string; expiresIn: 300 }> {
  return withUser(pool, userId, async (client) => {
    const r = await client.query<{ storage_key: string; display_name: string }>(
      `SELECT storage_key, display_name FROM credisync.dispute_evidence
       WHERE id = $1 AND dispute_id = $2 AND status = 'verified'`,
      [evidenceId, disputeId],
    );
    const row = r.rows[0];
    if (!row) throw evidenceNotFound();
    await writeAudit(client, {
      userId,
      eventType: 'data_access',
      resourceType: 'dispute_evidence',
      resourceId: evidenceId,
      payload: { action: 'download_evidence', evidence_id: evidenceId },
    });
    const url = await createEvidenceDownloadUrl(row.storage_key, row.display_name);
    return { url, expiresIn: 300 };
  });
}

/** Staff download of a verified file on a sent dispute, audited as admin_access. */
export async function adminEvidenceDownloadUrl(
  pool: Pool,
  actorId: string,
  disputeId: string,
  evidenceId: string,
): Promise<{ url: string; expiresIn: 300 }> {
  return withSystem(pool, async (client) => {
    const d = await client.query<{ status: string; user_id: string }>(
      'SELECT status, user_id FROM credisync.disputes WHERE id = $1',
      [disputeId],
    );
    const dispute = d.rows[0];
    if (!dispute) throw notFound();
    if (dispute.status === 'draft') {
      throw new DisputeError(
        409,
        'not_submitted',
        'Evidence is only available for disputes that have been sent',
      );
    }
    const r = await client.query<{ storage_key: string; display_name: string }>(
      `SELECT storage_key, display_name FROM credisync.dispute_evidence
       WHERE id = $1 AND dispute_id = $2 AND status = 'verified'`,
      [evidenceId, disputeId],
    );
    const row = r.rows[0];
    if (!row) throw evidenceNotFound();
    await writeAudit(client, {
      userId: dispute.user_id,
      performedBy: actorId,
      eventType: 'admin_access',
      resourceType: 'dispute_evidence',
      resourceId: evidenceId,
      payload: { action: 'download_evidence', evidence_id: evidenceId },
    });
    const url = await createEvidenceDownloadUrl(row.storage_key, row.display_name);
    return { url, expiresIn: 300 };
  });
}
