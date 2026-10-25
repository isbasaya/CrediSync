/**
 * Domain types for the bureau-ingestion service.
 *
 * These MUST stay aligned 1:1 with the PostgreSQL enums in db/schema.sql
 * (score_band, account_status, bureau_source) and the UI tokens in
 * design-system/tokens.ts. If you add a value here, add it in both places.
 */

export type ScoreBand = 'excellent' | 'good' | 'fair' | 'poor' | 'very_poor';

export type AccountStatus = 'current' | 'arrears' | 'default' | 'judgement' | 'written_off';

export type BureauSource = 'transunion' | 'experian' | 'xds';

export function getScoreBand(score: number): ScoreBand {
  if (score >= 767) return 'excellent';
  if (score >= 681) return 'good';
  if (score >= 614) return 'fair';
  if (score >= 583) return 'poor';
  return 'very_poor';
}

/**
 * Normalized shape every bureau adapter must produce, regardless of the
 * wildly different raw payloads TransUnion / Experian / XDS return.
 * This is the row shape persisted into `bureau_accounts`.
 */
export interface NormalizedBureauAccount {
  bureau: BureauSource;
  accountReference: string;
  creditorName: string;
  accountType: string;
  status: AccountStatus;
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
  score: number | null; // 0-999, null if bureau has no scoreable history (thin file)
  accounts: NormalizedBureauAccount[];
  enquiriesLast12m: number;
  judgementsCount: number;
  defaultsCount: number;
}

export interface BureauFetchRequest {
  userId: string;
  saIdHash: string; // pre-hashed lookup key; raw SA ID never leaves the user service
  firstName: string;
  lastName: string;
}

/** A resolved "same real-world account" cluster spanning 1-3 bureaus. */
export interface ResolvedAccountCluster {
  resolvedAccountId: string; // stable synthetic id for the cluster
  members: Array<{
    bureau: BureauSource;
    accountReference: string;
    confidence: number; // 0.000-1.000, similarity of this member to the cluster centroid
  }>;
  canonical: NormalizedBureauAccount; // the merged/representative record
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
