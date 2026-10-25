/**
 * Similarity primitives used by the entity resolution matcher.
 * Deliberately dependency-free (no fuzzy-matching library) so the scoring
 * logic is auditable — this feeds decisions that affect a consumer's
 * credit picture, so "why did these two records merge" must be traceable
 * to a plain function, not a black-box library.
 */

/** Levenshtein edit distance. */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prevRow = new Array(n + 1);
  let currRow = new Array(n + 1);
  for (let j = 0; j <= n; j++) prevRow[j] = j;

  for (let i = 1; i <= m; i++) {
    currRow[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      currRow[j] = Math.min(
        prevRow[j] + 1, // deletion
        currRow[j - 1] + 1, // insertion
        prevRow[j - 1] + cost // substitution
      );
    }
    [prevRow, currRow] = [currRow, prevRow];
  }
  return prevRow[n];
}

/** Common legal-entity noise words that shouldn't affect creditor matching. */
const CREDITOR_NOISE_WORDS = new Set([
  'bank',
  'ltd',
  'limited',
  'pty',
  '(pty)',
  'sa',
  'south',
  'africa',
  'financial',
  'services',
  'group',
  'holdings',
  'inc',
  'co',
]);

export function normalizeCreditorName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 0 && !CREDITOR_NOISE_WORDS.has(word))
    .join(' ')
    .trim();
}

/** Normalized string similarity in [0, 1], 1 = identical after normalization. */
export function creditorNameSimilarity(a: string, b: string): number {
  const na = normalizeCreditorName(a);
  const nb = normalizeCreditorName(b);
  if (na.length === 0 || nb.length === 0) return 0;
  if (na === nb) return 1;

  const distance = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  return Math.max(0, 1 - distance / maxLen);
}

/**
 * Bureaus label products differently ("CC", "Credit Card", "Revolving").
 * Each label is mapped to a product family; matching families score 1,
 * clearly different families 0, and an unrecognised label 0.6 (neutral —
 * not enough to block a merge on its own).
 */
const PRODUCT_FAMILIES: Array<[family: string, pattern: RegExp]> = [
  ['home_loan', /\b(home\s*loan|bond|mortgage)\b/],
  ['vehicle', /\b(vehicle|auto|car|asset\s*finance|instalment\s*sale)\b/],
  ['credit_card', /\b(credit\s*card|cc|revolving|card)\b/],
  ['overdraft', /\b(overdraft|od)\b/],
  ['retail', /\b(retail|clothing|store|furniture|open\s*account)\b/],
  ['telecom', /\b(cell(ular)?|telecom|mobile|contract)\b/],
  ['student', /\b(student|study|education)\b/],
  ['personal_loan', /\b(personal|unsecured|cash\s*loan|term\s*loan|micro\s*loan|loan)\b/],
];

export function productFamily(accountType: string): string | null {
  const label = accountType.toLowerCase().replace(/[_-]+/g, ' ');
  for (const [family, pattern] of PRODUCT_FAMILIES) {
    if (pattern.test(label)) return family;
  }
  return null;
}

export function accountTypeSimilarity(a: string, b: string): number {
  const fa = productFamily(a);
  const fb = productFamily(b);
  if (fa === null || fb === null) return 0.6;
  return fa === fb ? 1 : 0;
}

/** Closeness of two monetary amounts in [0, 1], tolerant of small bureau-to-bureau rounding drift. */
export function amountCloseness(a: number, b: number): number {
  if (a === 0 && b === 0) return 1;
  const diff = Math.abs(a - b);
  const scale = Math.max(Math.abs(a), Math.abs(b), 1);
  const relDiff = diff / scale;
  // Within 2% -> perfect match; beyond 25% apart -> no match.
  if (relDiff <= 0.02) return 1;
  if (relDiff >= 0.25) return 0;
  return 1 - (relDiff - 0.02) / (0.25 - 0.02);
}

/** Closeness of two ISO dates in [0, 1]; bureaus often report opened_date a few days apart. */
export function dateCloseness(a: string | null, b: string | null): number {
  if (!a || !b) return 0.5; // missing data is neutral, not disqualifying
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  if (Number.isNaN(da) || Number.isNaN(db)) return 0.5;

  const diffDays = Math.abs(da - db) / (1000 * 60 * 60 * 24);
  if (diffDays <= 7) return 1;
  if (diffDays >= 90) return 0;
  return 1 - (diffDays - 7) / (90 - 7);
}
