/**
 * Domain types for the open-banking service. Must stay aligned with
 * db/schema.sql's `transaction_category` enum and the
 * `financial_health_snapshots` / `transactions` tables.
 */

export type TransactionCategory =
  | 'income'
  | 'housing'
  | 'transport'
  | 'food_groceries'
  | 'utilities'
  | 'insurance'
  | 'debt_repayment'
  | 'savings'
  | 'entertainment'
  | 'healthcare'
  | 'education'
  | 'gambling'
  | 'transfers'
  | 'other';

export type IngestionSource = 'stitch' | 'ozow';

/** Normalized shape every open-banking adapter must produce. */
export interface NormalizedTransaction {
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

export interface FinancialHealthSnapshot {
  userId: string;
  periodStart: string;
  periodEnd: string;
  ingestionSource: IngestionSource;

  grossIncome: number;
  netIncome: number;
  incomeStreams: number;
  incomeRegularityScore: number; // 0-1

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
