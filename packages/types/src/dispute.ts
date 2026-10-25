import type { BureauSource, DisputeReason, DisputeStatus } from './enums';

export interface DisputeRecord {
  id: string;
  userId: string;
  bureauAccountId: string;
  bureau: BureauSource;
  disputeReason: DisputeReason;
  disputeDescription: string;
  supportingEvidence: string[];
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

  resolutionDeadline: string | null;
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
  saIdMasked: string;
  mobileNumber: string;
  email: string;
}

export type DisputeTransition = {
  [K in DisputeStatus]: DisputeStatus[];
};
