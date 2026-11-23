import type { Pool } from 'pg';
import { withSystem, writeAudit } from './index';

/**
 * An upload link may still be in flight (a slow PUT can begin before expiry and land after
 * it), so a row is only removed this long after its link expired. The scheduled job uses
 * the same rule.
 */
export const EVIDENCE_ERASE_MARGIN_MINUTES = 60;

export interface EvidenceErasureResult {
  erased: string[];
  /** Left 'deleting' for a later attempt: delete failed, or an upload link may still be live. */
  kept: string[];
  failed: string[];
}

/**
 * Deletes each object, then removes its row, and only then writes the
 * `data_deletion_completed` audit record in the same transaction as the row delete.
 * The database time is read BEFORE the object delete so the margin check can never
 * be satisfied by time that passed during the delete. Never throws.
 */
export async function finishEvidenceErasure(
  pool: Pool,
  rows: Array<{ id: string; storage_key: string }>,
  deleteObject: (key: string) => Promise<void>,
): Promise<EvidenceErasureResult> {
  const result: EvidenceErasureResult = { erased: [], kept: [], failed: [] };
  for (const row of rows) {
    try {
      const clock = await pool.query<{ t: Date }>('SELECT clock_timestamp() AS t');
      const before = clock.rows[0]!.t;
      await deleteObject(row.storage_key);
      const removed = await withSystem(pool, async (c) => {
        const r = await c.query<{ user_id: string }>(
          `DELETE FROM credisync.dispute_evidence
           WHERE id = $1 AND status = 'deleting'
             AND upload_url_expires_at + $3 * interval '1 minute' <= $2::timestamptz
           RETURNING user_id`,
          [row.id, before, EVIDENCE_ERASE_MARGIN_MINUTES],
        );
        const gone = r.rows[0];
        if (!gone) return false;
        await writeAudit(c, {
          userId: gone.user_id,
          eventType: 'data_deletion_completed',
          resourceType: 'dispute_evidence',
          resourceId: row.id,
          payload: { action: 'delete_evidence', evidence_id: row.id },
        });
        return true;
      });
      (removed ? result.erased : result.kept).push(row.id);
    } catch {
      result.failed.push(row.id);
    }
  }
  return result;
}
