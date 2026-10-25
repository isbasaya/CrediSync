/**
 * Domain types for the dispute-engine service. Must stay aligned with
 * db/schema.sql's `disputes` table and `dispute_status` enum.
 */

export type DisputeStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'resolved_upheld'
  | 'resolved_rejected'
  | 'escalated_ncr';

export type BureauSource = 'transunion' | 'experian' | 'xds';

/** NCA-recognised dispute grounds; drives which letter template clause is used. */
export type DisputeReason =
  | 'not_my_account'
  | 'incorrect_balance'
  | 'incorrect_status'
  | 'paid_but_reflecting_outstanding'
  | 'duplicate_listing'
  | 'identity_theft_fraud'
  | 'settled_in_full_not_updated'
  | 'prescribed_debt'
  | 'incorrect_personal_details';

export interface DisputeRecord {
  id: string;
  userId: string;
  bureauAccountId: string;
  bureau: BureauSource;
  disputeReason: DisputeReason;
  disputeDescription: string;
  supportingEvidence: string[]; // S3 object keys
  status: DisputeStatus;

  letterContent: string | null;
  letterGeneratedAt: string | null;
  letterVersion: number;

  submittedAt: string | null;
  bureauReference: string | null;
  bureauResponse: string | null;
  bureauRespondedAt: string | null;

  ncrCaseNumber: string | null;
  ncrEscalatedAt: string | null;

  resolutionDeadline: string | null; // date, NCA s71: 20 business days from submission
  createdAt: string;
  updatedAt: string;
}

export interface AccountContext {
  creditorName: string;
  accountType: string;
  accountReference: string;
  currentBalance: number;
  overdueAmount: number;
  status: string;
}

export interface ConsumerContext {
  fullName: string;
  saIdMasked: string; // e.g. "8501**-****-**5" — never full ID in a generated letter
  mobileNumber: string;
  email: string;
}
