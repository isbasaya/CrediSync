/**
 * Frontend domain types. ScoreBand/AccountStatus come from the design
 * tokens module so there is exactly one definition; everything else
 * mirrors the API gateway's responses.
 */
import type { AccountStatus, ScoreBand } from '../../../design-system/tokens';

export type { ScoreBand, AccountStatus } from '../../../design-system/tokens';

export type BureauSource = 'transunion' | 'experian' | 'xds';
export type BankReadinessTier = 'prime' | 'near_prime' | 'sub_prime' | 'unqualified';

export const BUREAU_LABELS: Record<BureauSource, string> = {
  transunion: 'TransUnion',
  experian: 'Experian',
  xds: 'XDS',
};

export interface BureauScore {
  bureau: BureauSource;
  score: number | null;
  scoreBand: ScoreBand | null;
  fetchedAt: string | null;
}

export interface CreditProfileSummary {
  id: string;
  userId: string;
  unifiedScore: number | null;
  unifiedScoreBand: ScoreBand | null;
  bureauScores: BureauScore[];
  totalAccounts: number;
  openAccounts: number;
  adverseAccounts: number;
  judgementsCount: number;
  defaultsCount: number;
  enquiriesLast12m: number;
  totalCreditExposure: number;
  monthlyInstalment: number;
  bankReadinessScore: number | null;
  bankReadinessTier: BankReadinessTier | null;
  lastRefreshedAt: string;
}

export interface BureauRecord {
  accountId: string;
  bureau: BureauSource;
  status: AccountStatus;
  currentBalance: number;
  overdueAmount: number;
}

/** One real-world credit facility, with every bureau that reports it. */
export interface BureauAccountSummary {
  id: string;
  resolvedAccountId: string;
  bureau: BureauSource;
  creditorName: string;
  accountType: string;
  status: AccountStatus;
  currentBalance: number;
  overdueAmount: number;
  monthsInArrears: number;
  reportedBy: BureauRecord[];
}

export interface RefreshResponse {
  profile: CreditProfileSummary;
  bureauFailures: Array<{ bureau: BureauSource; reason: string; retryable: boolean }>;
}

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

export const DISPUTE_REASON_LABELS: Record<DisputeReason, string> = {
  not_my_account: "This isn't my account",
  incorrect_balance: 'The balance or arrears amount is wrong',
  incorrect_status: 'The account status is wrong',
  paid_but_reflecting_outstanding: "I've paid it, but it still shows as owing",
  duplicate_listing: 'This account is listed twice',
  identity_theft_fraud: 'It was opened fraudulently in my name',
  settled_in_full_not_updated: "I settled it, but the record wasn't updated",
  prescribed_debt: 'The debt has prescribed',
  incorrect_personal_details: 'My personal details are wrong',
};

export type DisputeStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'resolved_upheld'
  | 'resolved_rejected'
  | 'escalated_ncr';

export const DISPUTE_STATUS_LABELS: Record<DisputeStatus, string> = {
  draft: 'Draft',
  submitted: 'Sent to bureau',
  under_review: 'Bureau investigating',
  resolved_upheld: 'Corrected',
  resolved_rejected: 'Not corrected',
  escalated_ncr: 'Escalated',
};

export interface Dispute {
  id: string;
  bureauAccountId: string;
  bureau: BureauSource;
  disputeReason: DisputeReason;
  disputeDescription: string;
  status: DisputeStatus;
  letterContent: string | null;
  submittedAt: string | null;
  resolutionDeadline: string | null;
  deadlineBreachedAt: string | null;
  bureauResponse: string | null;
  createdAt: string;
  creditorName?: string;
  accountType?: string;
}

export interface Me {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: 'consumer' | 'admin' | 'compliance_officer';
  is_verified: boolean;
  consents: {
    popia: boolean;
    popiaPolicyVersion: string | null;
    creditCheck: boolean;
    openBanking: boolean;
    marketing: boolean;
    thirdPartySharing: boolean;
  };
  currentPolicyVersion: string;
  deletionScheduledFor: string | null;
}
