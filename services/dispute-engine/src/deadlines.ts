/**
 * Credit bureaus must take reasonable steps to investigate a consumer's
 * challenge and respond within 20 business days (NCA s72 read with the
 * regulations — confirm the exact citation with counsel; see
 * templates/legal-references.ts). "Business day" excludes
 * Saturdays, Sundays, and South African public holidays (Public Holidays
 * Act 36 of 1994) — including the "Monday rule" (s2(1)): when a holiday
 * falls on a Sunday, the following Monday is also a public holiday.
 */

/** Anonymous Gregorian algorithm for the date of Easter Sunday in a given year. */
function computeEasterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = March, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Fixed-date SA public holidays for a given year, before the Sunday->Monday roll-forward rule. */
function fixedHolidays(year: number): Date[] {
  return [
    new Date(Date.UTC(year, 0, 1)), // New Year's Day
    new Date(Date.UTC(year, 2, 21)), // Human Rights Day
    new Date(Date.UTC(year, 3, 27)), // Freedom Day
    new Date(Date.UTC(year, 4, 1)), // Workers' Day
    new Date(Date.UTC(year, 5, 16)), // Youth Day
    new Date(Date.UTC(year, 7, 9)), // National Women's Day
    new Date(Date.UTC(year, 8, 24)), // Heritage Day
    new Date(Date.UTC(year, 11, 16)), // Day of Reconciliation
    new Date(Date.UTC(year, 11, 25)), // Christmas Day
    new Date(Date.UTC(year, 11, 26)), // Day of Goodwill
  ];
}

const holidayCache = new Map<number, Set<string>>();

function southAfricanPublicHolidays(year: number): Set<string> {
  const cached = holidayCache.get(year);
  if (cached) return cached;

  const easterSunday = computeEasterSunday(year);
  const goodFriday = addDays(easterSunday, -2);
  const familyDay = addDays(easterSunday, 1); // Easter Monday

  const holidays = [...fixedHolidays(year), goodFriday, familyDay];

  const withRollForward = new Set<string>();
  for (const holiday of holidays) {
    withRollForward.add(toDateKey(holiday));
    // Public Holidays Act s2(1): a Sunday holiday rolls to the following Monday.
    if (holiday.getUTCDay() === 0) {
      withRollForward.add(toDateKey(addDays(holiday, 1)));
    }
  }

  holidayCache.set(year, withRollForward);
  return withRollForward;
}

function isBusinessDay(date: Date, extraHolidays: ReadonlySet<string>): boolean {
  const day = date.getUTCDay();
  if (day === 0 || day === 6) return false; // Sunday, Saturday
  const key = toDateKey(date);
  return !southAfricanPublicHolidays(date.getUTCFullYear()).has(key) && !extraHolidays.has(key);
}

/** The calendar date in South Africa (SAST, UTC+2, no daylight saving) for an instant. */
export function southAfricanDate(instant: Date): Date {
  const key = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' }).format(instant); // YYYY-MM-DD
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * Adds `businessDays` business days to `startDate` (the dispute submission
 * date), skipping weekends and SA public holidays.
 */
export function addBusinessDays(
  startDate: Date,
  businessDays: number,
  extraHolidays: ReadonlySet<string> = new Set(),
): Date {
  let current = new Date(startDate.getTime());
  let remaining = businessDays;

  while (remaining > 0) {
    current = addDays(current, 1);
    if (isBusinessDay(current, extraHolidays)) {
      remaining -= 1;
    }
  }

  return current;
}

export const STATUTORY_RESPONSE_BUSINESS_DAYS = 20;

/**
 * Resolution deadline (YYYY-MM-DD) for a dispute submitted at `submittedAt`.
 * `extraHolidays` holds one-off holidays declared under the Public Holidays
 * Act (table public_holiday_overrides), as YYYY-MM-DD keys.
 */
export function computeResolutionDeadline(
  submittedAt: Date,
  extraHolidays: ReadonlySet<string> = new Set(),
): string {
  return toDateKey(
    addBusinessDays(southAfricanDate(submittedAt), STATUTORY_RESPONSE_BUSINESS_DAYS, extraHolidays),
  );
}
