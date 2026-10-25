/**
 * Domain types for the bureau-ingestion service. Enum types come from
 * @credisync/types, which is checked against db/schema.sql by a test.
 */
import type { AccountStatus, BureauSource, ScoreBand } from '@credisync/types';

export type { AccountStatus, BureauSource, ScoreBand } from '@credisync/types';
export { getScoreBand } from '@credisync/types';

/**
 * Normalized shape every bureau adapter must produce, regardless of the
 * very different raw payloads TransUnion / Experian / XDS return.
 * This is the row shape persisted into `bureau_accounts`.
 */
export interface NormalizedBureauAccount {
  bureau: BureauSource;
  accountReference: string;
  creditorName: string;
  accountType: string;
  status: AccountStatus;
  rawStatus: string | null;
  openedDate: string | null; // ISO date
  closedDate: string | null;
  creditLimit: number | null;
  currentBalance: number;
  overdueAmount: number;
  instalmentAmount: number;
  monthsInArrears: number;
  worstStatus12m: AccountStatus | null;
  paymentProfile: string | null; // 24-char rolling payment string
}

export interface NormalizedBureauReport {
  bureau: BureauSource;
  fetchedAt: string; // ISO timestamp
  score: number | null; // as reported by the bureau, null for a thin file
  accounts: NormalizedBureauAccount[];
  enquiriesLast12m: number;
  judgementsCount: number;
  defaultsCount: number;
}

/**
 * What adapters need to identify the consumer. The SA ID number is
 * decrypted just-in-time inside this service (bureaus match on the real
 * ID, not a hash) and must never be logged or persisted from here.
 */
export interface BureauFetchRequest {
  userId: string;
  saIdNumber: string;
  firstName: string;
  lastName: string;
}

/** A resolved "same real-world account" cluster spanning 1-3 bureaus. */
export interface ResolvedAccountCluster {
  resolvedAccountId: string;
  /** Each bureau's own record, unmodified, plus its similarity to the canonical view. */
  members: Array<{ account: NormalizedBureauAccount; confidence: number }>;
  /** Merged view used for totals: most conservative figures across members. */
  canonical: NormalizedBureauAccount;
}

export interface UnifiedCreditProfile {
  unifiedScore: number | null;
  unifiedScoreBand: ScoreBand | null;
  entityResolutionVersion: number;

  transunionScore: number | null;
  transunionScoreBand: ScoreBand | null;
  experianScore: number | null;
  experianScoreBand: ScoreBand | null;
  xdsScore: number | null;
  xdsScoreBand: ScoreBand | null;

  totalAccounts: number;
  openAccounts: number;
  adverseAccounts: number;
  judgementsCount: number;
  defaultsCount: number;
  enquiriesLast12m: number;
  totalCreditExposure: number;
  monthlyInstalment: number;

  resolvedClusters: ResolvedAccountCluster[];
}
