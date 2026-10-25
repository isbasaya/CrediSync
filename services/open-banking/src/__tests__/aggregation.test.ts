import { describe, it, expect } from 'vitest';
import { categorize } from '../categorization/categorizer';
import { minimumExpenseNorm } from '../aggregation/expense-norms';
import { buildFinancialHealthSnapshot, periodMonths } from '../aggregation/snapshot-builder';
import type { NormalizedAccountFeed, NormalizedTransaction } from '../types';

function tx(
  amount: number,
  description: string,
  date = '2026-08-25',
  merchant: string | null = null,
): NormalizedTransaction {
  return {
    providerTransactionId: `${date}-${description}`,
    transactionDate: date,
    postedDate: date,
    amount,
    currency: 'ZAR',
    description,
    merchantName: merchant,
    reference: null,
    isRecurring: false,
  };
}

describe('categorize', () => {
  it('treats salary credits as income', () => {
    expect(categorize(tx(28500, 'SALARY ACME HOLDINGS'))).toBe('income');
    expect(categorize(tx(2090, 'SASSA OLD AGE GRANT'))).toBe('income');
  });

  it('does not treat unrecognised credits, refunds or own-account transfers as income', () => {
    expect(categorize(tx(5000, 'CASH DEPOSIT BRANCH'))).toBe('other');
    expect(categorize(tx(450, 'REFUND TAKEALOT ORDER'))).toBe('transfers');
    expect(categorize(tx(3000, 'TRANSFER FROM SAVINGS'))).toBe('transfers');
  });

  it('does not count paying someone a salary as income', () => {
    expect(categorize(tx(-3500, 'DOMESTIC WORKER SALARY'))).not.toBe('income');
  });

  it('classifies Discovery Health as healthcare, not insurance, and gambling before entertainment', () => {
    expect(categorize(tx(-3200, 'DISCOVERY HEALTH MEDICAL AID'))).toBe('healthcare');
    expect(categorize(tx(-500, 'DISCOVERY INSURE'))).toBe('insurance');
    expect(categorize(tx(-200, 'BETWAY BAR TAB'))).toBe('gambling');
  });
});

describe('minimumExpenseNorm (NCA affordability regulations table)', () => {
  it('applies the band fixed amount plus the marginal rate', () => {
    expect(minimumExpenseNorm(500)).toBe(800);
    expect(minimumExpenseNorm(6250)).toBe(Number((800 + (6250 - 800) * 0.0675).toFixed(2)));
    expect(minimumExpenseNorm(20000)).toBe(Number((1167.88 + (20000 - 6250) * 0.09).toFixed(2)));
    expect(minimumExpenseNorm(80000)).toBe(Number((4905.38 + (80000 - 50000) * 0.0675).toFixed(2)));
  });
});

describe('buildFinancialHealthSnapshot', () => {
  const feed = (
    transactions: NormalizedTransaction[],
    start = '2026-06-01',
    end = '2026-08-31',
  ): NormalizedAccountFeed => ({
    source: 'stitch',
    accountId: 'acc',
    periodStart: start,
    periodEnd: end,
    transactions,
    closingBalances: [
      { date: '2026-08-20', balance: -100 },
      { date: '2026-08-31', balance: 2500 },
    ],
  });

  it('reports monthly figures, not period totals', () => {
    const snapshot = buildFinancialHealthSnapshot(
      'u',
      feed([
        tx(30000, 'SALARY ACME', '2026-06-25'),
        tx(30000, 'SALARY ACME', '2026-07-25'),
        tx(30000, 'SALARY ACME', '2026-08-25'),
        tx(-9000, 'RENTAL PAYMENT', '2026-07-01'),
      ]),
    );
    expect(periodMonths('2026-06-01', '2026-08-31')).toBe(3);
    expect(periodMonths('2026-06-10', '2026-07-24')).toBeCloseTo(1.48, 2);
    expect(snapshot.netIncome).toBe(30000);
    expect(snapshot.incomeRegularityScore).toBe(1);
  });

  it('keeps unclassified credits out of income and uses the expense norm when observed spend is lower', () => {
    const snapshot = buildFinancialHealthSnapshot(
      'u',
      feed([tx(20000, 'SALARY X'), tx(15000, 'CASH DEPOSIT')], '2026-08-01', '2026-08-31'),
    );
    expect(snapshot.netIncome).toBe(20000);
    expect(snapshot.unclassifiedCredits).toBe(15000);
    expect(snapshot.minimumExpenseNorm).toBeGreaterThan(0);
    expect(snapshot.affordabilitySurplus).toBe(
      Number((20000 - snapshot.minimumExpenseNorm!).toFixed(2)),
    );
    expect(snapshot.overdraftDays30d).toBe(1);
  });
});
