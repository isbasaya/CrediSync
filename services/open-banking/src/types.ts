/**
 * Domain types for the open-banking service. Enum types come from
 * @credisync/types, which is checked against db/schema.sql by a test.
 */
import type { IngestionSource, TransactionCategory } from '@credisync/types';

export type { IngestionSource, TransactionCategory } from '@credisync/types';

/** Normalized shape every open-banking adapter must produce. */
export interface NormalizedTransaction {
  providerTransactionId: string | null; // for de-duplication across ingests
  transactionDate: string; // ISO date
  postedDate: string | null;
  amount: number; // negative = debit, positive = credit, matches schema convention
  currency: string;
  description: string;
  merchantName: string | null;
  reference: string | null;
  isRecurring: boolean;
}

export interface NormalizedAccountFeed {
  source: IngestionSource;
  accountId: string; // provider's account identifier
  periodStart: string;
  periodEnd: string;
  transactions: NormalizedTransaction[];
  closingBalances: Array<{ date: string; balance: number }>; // daily closing balance series for the period
}

export interface CategorizedTransaction extends NormalizedTransaction {
  category: TransactionCategory;
}

/** All monetary figures are MONTHLY averages over the period. */
export interface FinancialHealthSnapshot {
  userId: string;
  periodStart: string;
  periodEnd: string;
  periodMonths: number;
  ingestionSource: IngestionSource;

  grossIncome: number;
  netIncome: number;
  incomeStreams: number;
  incomeRegularityScore: number; // 0-1
  unclassifiedCredits: number;

  housingExpenses: number;
  transportExpenses: number;
  foodExpenses: number;
  utilitiesExpenses: number;
  insuranceExpenses: number;
  debtRepaymentTotal: number;
  entertainmentExpenses: number;
  gamblingSpend: number;

  debtToIncomeRatio: number | null;
  savingsRate: number | null;

  averageClosingBalance: number;
  lowestBalance30d: number | null;
  overdraftDays30d: number;
  returnedDebitCount: number;

  minimumExpenseNorm: number | null;
  affordabilitySurplus: number | null;
  ncaNettIncome: number | null;

  transactions: CategorizedTransaction[];
}
