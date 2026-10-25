import type { IngestionSource, TransactionCategory } from './enums';

export interface NormalizedTransaction {
  transactionDate: string;
  postedDate: string | null;
  amount: number;
  currency: string;
  description: string;
  merchantName: string | null;
  reference: string | null;
  isRecurring: boolean;
}

export interface NormalizedAccountFeed {
  source: IngestionSource;
  accountId: string;
  periodStart: string;
  periodEnd: string;
  transactions: NormalizedTransaction[];
  closingBalances: Array<{ date: string; balance: number }>;
}

export interface CategorizedTransaction extends NormalizedTransaction {
  category: TransactionCategory;
}

export interface FinancialHealthSnapshot {
  userId: string;
  periodStart: string;
  periodEnd: string;
  ingestionSource: IngestionSource;

  grossIncome: number;
  netIncome: number;
  incomeStreams: number;
  incomeRegularityScore: number;

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

  affordabilitySurplus: number | null;
  ncaNettIncome: number | null;

  transactions: CategorizedTransaction[];
}
