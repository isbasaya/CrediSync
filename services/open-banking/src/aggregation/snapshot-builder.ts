import { categorizeAll } from '../categorization/categorizer';
import { minimumExpenseNorm, type ExpenseNormBand, DEFAULT_EXPENSE_NORMS } from './expense-norms';
import type {
  CategorizedTransaction,
  FinancialHealthSnapshot,
  NormalizedAccountFeed,
} from '../types';

const RETURNED_DEBIT_PATTERN =
  /\b(returned|insufficient\s*funds|debit\s*order\s*unpaid|unpaid\s*item|rd\s*fee)\b/i;
const DAY_MS = 24 * 60 * 60 * 1000;

function sumDebits(transactions: CategorizedTransaction[], category: string): number {
  return transactions
    .filter((t) => t.category === category && t.amount < 0)
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);
}

function normalizeDescriptionKey(t: CategorizedTransaction): string {
  return (t.merchantName ?? t.description).trim().toLowerCase().replace(/\d+/g, '');
}

/**
 * Period length in months (≥ 1), from inclusive start/end dates. Whole
 * calendar months (1st to last day) count exactly; anything else uses the
 * average month length.
 */
export function periodMonths(periodStart: string, periodEnd: string): number {
  const start = new Date(`${periodStart}T00:00:00Z`);
  const end = new Date(`${periodEnd}T00:00:00Z`);
  const dayAfterEnd = new Date(end.getTime() + DAY_MS);
  if (start.getUTCDate() === 1 && dayAfterEnd.getUTCDate() === 1) {
    const months =
      (dayAfterEnd.getUTCFullYear() - start.getUTCFullYear()) * 12 +
      (dayAfterEnd.getUTCMonth() - start.getUTCMonth());
    return Math.max(1, months);
  }
  const days = (end.getTime() - start.getTime()) / DAY_MS + 1;
  return Math.max(1, Number((days / 30.4375).toFixed(2)));
}

/**
 * Regularity of income in [0, 1] from the coefficient of variation of
 * MONTHLY income totals (not individual deposits, so a salary paid in two
 * halves isn't penalised). One month of data scores 0.5: not enough
 * history to call it regular or irregular.
 */
function incomeRegularityScore(income: CategorizedTransaction[]): number {
  if (income.length === 0) return 0;
  const byMonth = new Map<string, number>();
  for (const t of income)
    byMonth.set(
      t.transactionDate.slice(0, 7),
      (byMonth.get(t.transactionDate.slice(0, 7)) ?? 0) + t.amount,
    );
  const totals = [...byMonth.values()];
  if (totals.length === 1) return 0.5;

  const mean = totals.reduce((s, a) => s + a, 0) / totals.length;
  if (mean <= 0) return 0;
  const variance = totals.reduce((s, a) => s + (a - mean) ** 2, 0) / totals.length;
  const cov = Math.sqrt(variance) / mean;
  return Math.max(0, Math.min(1, 1 - cov / 0.5));
}

function last30Days(periodEnd: string, balances: NormalizedAccountFeed['closingBalances']) {
  const cutoff = Date.parse(periodEnd) - 30 * DAY_MS;
  return balances.filter((b) => Date.parse(b.date) > cutoff);
}

const money = (n: number) => Number(n.toFixed(2));

export function buildFinancialHealthSnapshot(
  userId: string,
  feed: NormalizedAccountFeed,
  norms: ExpenseNormBand[] = DEFAULT_EXPENSE_NORMS,
): FinancialHealthSnapshot {
  const categorized = categorizeAll(feed.transactions);
  const months = periodMonths(feed.periodStart, feed.periodEnd);
  const monthly = (total: number) => money(total / months);

  const incomeTransactions = categorized.filter((t) => t.category === 'income' && t.amount > 0);
  const netIncome = monthly(incomeTransactions.reduce((sum, t) => sum + t.amount, 0));
  const unclassifiedCredits = monthly(
    categorized
      .filter((t) => t.category === 'other' && t.amount > 0)
      .reduce((sum, t) => sum + t.amount, 0),
  );

  const housing = monthly(sumDebits(categorized, 'housing'));
  const transport = monthly(sumDebits(categorized, 'transport'));
  const food = monthly(sumDebits(categorized, 'food_groceries'));
  const utilities = monthly(sumDebits(categorized, 'utilities'));
  const insurance = monthly(sumDebits(categorized, 'insurance'));
  const healthcare = monthly(sumDebits(categorized, 'healthcare'));
  const education = monthly(sumDebits(categorized, 'education'));
  const debtRepayment = monthly(sumDebits(categorized, 'debt_repayment'));
  const entertainment = monthly(sumDebits(categorized, 'entertainment'));
  const gambling = monthly(sumDebits(categorized, 'gambling'));
  const savings = monthly(sumDebits(categorized, 'savings'));
  const otherSpend = monthly(sumDebits(categorized, 'other'));

  const livingExpenses =
    housing +
    transport +
    food +
    utilities +
    insurance +
    healthcare +
    education +
    entertainment +
    gambling +
    otherSpend;
  // Bank feeds show net (after-tax) inflow; it's used here as the income
  // figure for the norm lookup, which makes the norm slightly lower than a
  // gross-income calculation would. See expense-norms.ts.
  const norm = minimumExpenseNorm(netIncome, norms);
  const affordabilitySurplus = money(netIncome - Math.max(livingExpenses, norm) - debtRepayment);

  const recent = last30Days(feed.periodEnd, feed.closingBalances);
  const averageClosingBalance =
    feed.closingBalances.length > 0
      ? feed.closingBalances.reduce((s, b) => s + b.balance, 0) / feed.closingBalances.length
      : 0;

  return {
    userId,
    periodStart: feed.periodStart,
    periodEnd: feed.periodEnd,
    periodMonths: months,
    ingestionSource: feed.source,

    // Gross income needs payslip data; until then it mirrors observed net income.
    grossIncome: netIncome,
    netIncome,
    incomeStreams: new Set(incomeTransactions.map(normalizeDescriptionKey)).size,
    incomeRegularityScore: Number(incomeRegularityScore(incomeTransactions).toFixed(3)),
    unclassifiedCredits,

    housingExpenses: housing,
    transportExpenses: transport,
    foodExpenses: food,
    utilitiesExpenses: utilities,
    insuranceExpenses: insurance,
    debtRepaymentTotal: debtRepayment,
    entertainmentExpenses: entertainment,
    gamblingSpend: gambling,

    debtToIncomeRatio:
      netIncome > 0 ? Number(Math.min(9.9999, debtRepayment / netIncome).toFixed(4)) : null,
    savingsRate: netIncome > 0 ? Number(Math.min(9.9999, savings / netIncome).toFixed(4)) : null,

    averageClosingBalance: money(averageClosingBalance),
    lowestBalance30d: recent.length > 0 ? money(Math.min(...recent.map((b) => b.balance))) : null,
    overdraftDays30d: Math.min(30, recent.filter((b) => b.balance < 0).length),
    returnedDebitCount: categorized.filter((t) => RETURNED_DEBIT_PATTERN.test(t.description))
      .length,

    minimumExpenseNorm: norm,
    affordabilitySurplus,
    ncaNettIncome: netIncome,

    transactions: categorized,
  };
}
