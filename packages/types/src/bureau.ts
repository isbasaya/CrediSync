import type { BureauSource, ScoreBand, AccountStatus } from './enums';

export interface NormalizedBureauAccount {
  bureau: BureauSource;
  accountReference: string;
  creditorName: string;
  accountType: string;
  status: AccountStatus;
  openedDate: string | null;
  closedDate: string | null;
  creditLimit: number | null;
  currentBalance: number;
  overdueAmount: number;
  instalmentAmount: number;
  monthsInArrears: number;
  worstStatus12m: AccountStatus | null;
  paymentProfile: string | null;
}

export interface NormalizedBureauReport {
  bureau: BureauSource;
  fetchedAt: string;
  score: number | null;
  accounts: NormalizedBureauAccount[];
  enquiriesLast12m: number;
  judgementsCount: number;
  defaultsCount: number;
}

export interface BureauFetchRequest {
  userId: string;
  saIdHash: string;
  firstName: string;
  lastName: string;
}

export interface ResolvedAccountCluster {
  resolvedAccountId: string;
  members: Array<{
    bureau: BureauSource;
    accountReference: string;
    confidence: number;
  }>;
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
