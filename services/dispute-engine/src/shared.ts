import type { PoolClient } from 'pg';
import { decryptFromBytes } from '@credisync/crypto';
import {
  maskSaIdNumber,
  type DisputeEvidence,
  type DisputeReason,
  type DisputeStatus,
} from '@credisync/types';
import type { AccountContext, DisputeRecord } from './types';

export class DisputeError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DisputeError';
  }
}

export const notFound = () => new DisputeError(404, 'not_found', 'Dispute not found');

export function toRecord(r: Record<string, unknown>, evidence: DisputeEvidence[]): DisputeRecord {
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  const date = (v: unknown) =>
    v ? (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)) : null;
  return {
    id: r.id as string,
    userId: r.user_id as string,
    bureauAccountId: r.bureau_account_id as string,
    bureau: r.bureau as DisputeRecord['bureau'],
    disputeReason: r.dispute_reason as DisputeReason,
    disputeDescription: r.dispute_description as string,
    evidence,
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

export const SELECT_DISPUTE = `
  SELECT d.*, ba.creditor_name, ba.account_type
  FROM credisync.disputes d
  JOIN credisync.bureau_accounts ba ON ba.id = d.bureau_account_id`;

/** `revealFullId` is only for the audited operations lodging copy. */
export async function consumerContext(client: PoolClient, userId: string, revealFullId = false) {
  const r = await client.query(
    'SELECT first_name, last_name, mobile_number, email, sa_id_encrypted FROM credisync.users WHERE id = $1',
    [userId],
  );
  const u = r.rows[0];
  if (!u) throw new DisputeError(404, 'not_found', 'User not found');
  const saId = await decryptFromBytes(u.sa_id_encrypted);
  return {
    fullName: `${u.first_name} ${u.last_name}`,
    saIdMasked: revealFullId ? saId : maskSaIdNumber(saId),
    mobileNumber: u.mobile_number as string,
    email: u.email as string,
  };
}

export async function accountContext(
  client: PoolClient,
  bureauAccountId: string,
): Promise<(AccountContext & { bureau: DisputeRecord['bureau'] }) | null> {
  const r = await client.query(
    `SELECT bureau, creditor_name, account_type, account_reference, current_balance, overdue_amount, status
     FROM credisync.bureau_accounts WHERE id = $1`,
    [bureauAccountId],
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
