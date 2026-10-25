/**
 * Minimum monthly living-expense norms from the NCA Affordability
 * Assessment Regulations (2015), Table 1: a fixed amount for the income band
 * plus a percentage of monthly gross income above the band's lower bound.
 *
 * VERIFY against the current Government Gazette before relying on this in
 * a credit decision — the National Credit Regulator may have revised the
 * table. Override without a code change via NCA_EXPENSE_NORMS (JSON array
 * of { min, max, fixed, rate }).
 *
 * Note: the table is defined on GROSS income. Bank feeds only show net
 * inflows, so callers pass the best available income figure and the
 * result is a conservative approximation until payslip data is integrated.
 */
export interface ExpenseNormBand {
  min: number;
  max: number | null;
  fixed: number;
  rate: number;
}

export const DEFAULT_EXPENSE_NORMS: ExpenseNormBand[] = [
  { min: 0, max: 800, fixed: 800, rate: 0 },
  { min: 800.01, max: 6250, fixed: 800, rate: 0.0675 },
  { min: 6250.01, max: 25000, fixed: 1167.88, rate: 0.09 },
  { min: 25000.01, max: 50000, fixed: 2855.38, rate: 0.082 },
  { min: 50000.01, max: null, fixed: 4905.38, rate: 0.0675 },
];

export function loadExpenseNorms(env: NodeJS.ProcessEnv = process.env): ExpenseNormBand[] {
  return env.NCA_EXPENSE_NORMS
    ? (JSON.parse(env.NCA_EXPENSE_NORMS) as ExpenseNormBand[])
    : DEFAULT_EXPENSE_NORMS;
}

export function minimumExpenseNorm(
  monthlyIncome: number,
  bands: ExpenseNormBand[] = DEFAULT_EXPENSE_NORMS,
): number {
  if (monthlyIncome <= 0) return bands[0]!.fixed;
  const band =
    bands.find((b) => monthlyIncome >= b.min && (b.max === null || monthlyIncome <= b.max)) ??
    bands[bands.length - 1]!;
  const lower = band.min <= 0 ? 0 : Math.floor(band.min);
  return Number((band.fixed + Math.max(0, monthlyIncome - lower) * band.rate).toFixed(2));
}
