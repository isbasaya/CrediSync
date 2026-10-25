export type { ScoreBand, AccountStatus, BankReadinessTier } from '@credisync/types';
import type { ScoreBand, AccountStatus, BankReadinessTier } from '@credisync/types';

export type BureauSource = 'transunion' | 'experian' | 'xds';

export interface BureauScore {
  bureau: BureauSource;
  score: number | null;
  scoreBand: ScoreBand | null;
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
  bankReadinessScore: number | null;
  bankReadinessTier: BankReadinessTier | null;
  lastRefreshedAt: string;
}

export interface BureauAccountSummary {
  id: string;
  bureau: BureauSource;
  creditorName: string;
  accountType: string;
  status: AccountStatus;
  currentBalance: number;
  overdueAmount: number;
  monthsInArrears: number;
}
