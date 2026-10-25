/**
 * Frontend domain types. ScoreBand/AccountStatus are re-exported from the
 * design tokens module so there is exactly one definition; everything
 * else here mirrors the API gateway's response shape for the
 * `v_active_credit_profiles` / `bureau_accounts` / `disputes` views in
 * db/schema.sql.
 */
export type { ScoreBand, AccountStatus } from '../../../design-system/tokens';

export type BureauSource = 'transunion' | 'experian' | 'xds';

export interface BureauScore {
  bureau: BureauSource;
  score: number | null;
  scoreBand: import('../../../design-system/tokens').ScoreBand | null;
}

export interface CreditProfileSummary {
  id: string;
  userId: string;
  unifiedScore: number | null;
  unifiedScoreBand: import('../../../design-system/tokens').ScoreBand | null;
  bureauScores: BureauScore[];
  totalAccounts: number;
  openAccounts: number;
  adverseAccounts: number;
  judgementsCount: number;
  defaultsCount: number;
  enquiriesLast12m: number;
  totalCreditExposure: number;
  bankReadinessScore: number | null;
  bankReadinessTier: 'prime' | 'near_prime' | 'sub_prime' | 'unqualified' | null;
  lastRefreshedAt: string;
}

export interface BureauAccountSummary {
  id: string;
  bureau: BureauSource;
  creditorName: string;
  accountType: string;
  status: import('../../../design-system/tokens').AccountStatus;
  currentBalance: number;
  overdueAmount: number;
  monthsInArrears: number;
}
