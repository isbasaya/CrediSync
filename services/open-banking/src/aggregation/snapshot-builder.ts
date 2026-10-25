import { categorizeAll } from '../categorization/categorizer';
import type { CategorizedTransaction, FinancialHealthSnapshot, NormalizedAccountFeed } from '../types';

const RETURNED_DEBIT_PATTERN = /\b(returned|reversed|insufficient\s*funds|debit\s*order\s*unpaid|unpaid\s*item)\b/i;

function sumCategory(transactions: CategorizedTransaction[], category: string): number {
  return transactions
    .filter((t) => t.category === category && t.amount < 0)
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);
}

function normalizeDescriptionKey(t: CategorizedTransaction): string {
  return (t.merchantName ?? t.description).trim().toLowerCase();
}

/**
 * Regularity of income deposits in [0, 1] using the coefficient of
 * variation (CoV) of deposit amounts: CoV = stddev / mean. Low CoV
 * (consistent salary amounts) -> score near 1; high CoV (irregular gig
 * income) -> score near 0. A single deposit in the period is treated as
 * maximally regular (nothing to compare against yet, not a red flag).
 */
function incomeRegularityScore(incomeAmounts: number[]): number {
  if (incomeAmounts.length === 0) return 0;
  if (incomeAmounts.length === 1) return 1;

  const mean = incomeAmounts.reduce((sum, a) => sum + a, 0) / incomeAmounts.length;
  if (mean === 0) return 0;

  const variance = incomeAmounts.reduce((sum, a) => sum + (a - mean) ** 2, 0) / incomeAmounts.length;
  const coefficientOfVariation = Math.sqrt(variance) / mean;

  // CoV of 0 -> score 1; CoV of 0.5+ (highly irregular) -> score 0.
  return Math.max(0, Math.min(1, 1 - coefficientOfVariation / 0.5));
}

function last30Days(periodEnd: string, closingBalances: NormalizedAccountFeed['closingBalances']): typeof closingBalances {
  const cutoff = new Date(periodEnd);
  cutoff.setDate(cutoff.getDate() - 30);
  return closingBalances.filter((b) => new Date(b.date) >= cutoff);
}

export function buildFinancialHealthSnapshot(userId: string, feed: NormalizedAccountFeed): FinancialHealthSnapshot {
  const categorized = categorizeAll(feed.transactions);

  const incomeTransactions = categorized.filter((t) => t.category === 'income' && t.amount > 0);
  const incomeAmounts = incomeTransactions.map((t) => t.amount);
  // Bank feeds only observe net cash inflow; true gross income requires a
  // payslip/HR integration that doesn't exist yet, so grossIncome is
  // provisioned as a field for that future source and defaults to the
  // observed net figure in the meantime.
  const netIncome = incomeAmounts.reduce((sum, a) => sum + a, 0);
  const grossIncome = netIncome;
  const incomeStreams = new Set(incomeTransactions.map(normalizeDescriptionKey)).size;

  const housingExpenses = sumCategory(categorized, 'housing');
  const transportExpenses = sumCategory(categorized, 'transport');
  const foodExpenses = sumCategory(categorized, 'food_groceries');
  const utilitiesExpenses = sumCategory(categorized, 'utilities');
  const insuranceExpenses = sumCategory(categorized, 'insurance');
  const debtRepaymentTotal = sumCategory(categorized, 'debt_repayment');
  const entertainmentExpenses = sumCategory(categorized, 'entertainment');
  const gamblingSpend = sumCategory(categorized, 'gambling');
  const savingsContributions = sumCategory(categorized, 'savings');

  const totalCommittedExpenses =
    housingExpenses +
    transportExpenses +
    foodExpenses +
    utilitiesExpenses +
    insuranceExpenses +
    debtRepaymentTotal +
    entertainmentExpenses +
    gamblingSpend;

  const recentBalances = last30Days(feed.periodEnd, feed.closingBalances);
  const averageClosingBalance =
    feed.closingBalances.length > 0
      ? feed.closingBalances.reduce((sum, b) => sum + b.balance, 0) / feed.closingBalances.length
      : 0;
  const lowestBalance30d = recentBalances.length > 0 ? Math.min(...recentBalances.map((b) => b.balance)) : null;
  const overdraftDays30d = recentBalances.filter((b) => b.balance < 0).length;

  const returnedDebitCount = categorized.filter((t) => RETURNED_DEBIT_PATTERN.test(t.description)).length;

  return {
    userId,
    periodStart: feed.periodStart,
    periodEnd: feed.periodEnd,
    ingestionSource: feed.source,

    grossIncome: Number(grossIncome.toFixed(2)),
    netIncome: Number(netIncome.toFixed(2)),
    incomeStreams,
    incomeRegularityScore: Number(incomeRegularityScore(incomeAmounts).toFixed(3)),

    housingExpenses: Number(housingExpenses.toFixed(2)),
    transportExpenses: Number(transportExpenses.toFixed(2)),
    foodExpenses: Number(foodExpenses.toFixed(2)),
    utilitiesExpenses: Number(utilitiesExpenses.toFixed(2)),
    insuranceExpenses: Number(insuranceExpenses.toFixed(2)),
    debtRepaymentTotal: Number(debtRepaymentTotal.toFixed(2)),
    entertainmentExpenses: Number(entertainmentExpenses.toFixed(2)),
    gamblingSpend: Number(gamblingSpend.toFixed(2)),

    debtToIncomeRatio: netIncome > 0 ? Number((debtRepaymentTotal / netIncome).toFixed(4)) : null,
    savingsRate: netIncome > 0 ? Number((savingsContributions / netIncome).toFixed(4)) : null,

    averageClosingBalance: Number(averageClosingBalance.toFixed(2)),
    lowestBalance30d: lowestBalance30d !== null ? Number(lowestBalance30d.toFixed(2)) : null,
    overdraftDays30d,
    returnedDebitCount,

    affordabilitySurplus: Number((netIncome - totalCommittedExpenses).toFixed(2)),
    // NCA Regulation 2 "net income" = gross income less PAYE/UIF/pension at
    // source. We only observe post-deduction bank inflow, which is itself
    // a reasonable proxy for that figure absent a payslip integration.
    ncaNettIncome: Number(netIncome.toFixed(2)),

    transactions: categorized,
  };
}
