/**
 * Domain types for the dispute-engine service. Enum types come from
 * @credisync/types, which is checked against db/schema.sql by a test.
 */
export type { BureauSource, DisputeReason, DisputeStatus } from '@credisync/types';
export { DISPUTE_REASONS, BUREAU_SOURCES } from '@credisync/types';
import type { BureauSource, DisputeReason, DisputeStatus } from '@credisync/types';

export interface DisputeRecord {
  id: string;
  userId: string;
  bureauAccountId: string;
  bureau: BureauSource;
  disputeReason: DisputeReason;
  disputeDescription: string;
  supportingEvidence: string[]; // storage object keys
  status: DisputeStatus;

  letterContent: string | null;
  letterGeneratedAt: string | null;
  letterVersion: number;

  submittedAt: string | null;
  submissionChannel: string | null;
  bureauReference: string | null;
  bureauResponse: string | null;
  bureauRespondedAt: string | null;
  resolvedAt: string | null;

  ncrCaseNumber: string | null;
  ncrEscalatedAt: string | null;

  resolutionDeadline: string | null; // 20 business days from submission
  deadlineBreachedAt: string | null;
  createdAt: string;
  updatedAt: string;

  /** Joined from bureau_accounts for display. */
  creditorName?: string;
  accountType?: string;
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
  saIdMasked: string; // e.g. "*********9087" — never the full ID in a stored letter
  mobileNumber: string;
  email: string;
}
