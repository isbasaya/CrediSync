import pino from 'pino';
import type { AccountStatus } from '../types';

const logger = pino({ name: 'bureau-ingestion:status-mapping' });

/**
 * Every bureau reports account status using its own vocabulary. This maps
 * each bureau's raw status strings to our canonical AccountStatus enum,
 * which is the single source of truth shared with db/schema.sql and
 * design-system/tokens.ts.
 *
 * NOTE: the raw string keys below are placeholders for the field values
 * documented in each bureau's API contract (obtained under NDA once the
 * bureau integration agreement is signed). Swap them in per bureau; every
 * downstream consumer only sees AccountStatus.
 */
const STATUS_TABLE: Record<string, AccountStatus> = {
  // In good standing (open, or closed/settled with nothing owing)
  current: 'current',
  up_to_date: 'current',
  'up to date': 'current',
  performing: 'current',
  paid_up: 'current',
  'paid up': 'current',
  settled: 'current',
  closed: 'current',
  closed_paid: 'current',

  arrears: 'arrears',
  'past due': 'arrears',
  delinquent: 'arrears',

  default: 'default',
  'in default': 'default',
  charged_off: 'default',

  judgement: 'judgement',
  judgment: 'judgement',
  'legal action': 'judgement',

  written_off: 'written_off',
  'written off': 'written_off',
  closed_bad_debt: 'written_off',
};

/**
 * Unmapped statuses become 'unknown' rather than a guess. Guessing
 * 'current' would understate risk; guessing 'arrears' would show a consumer
 * an adverse listing that may not exist. 'unknown' is shown neutrally,
 * excluded from adverse counts, and logged so the mapping can be extended.
 */
export function mapBureauStatus(bureau: string, rawStatus: string): AccountStatus {
  const normalized = rawStatus.trim().toLowerCase();
  const mapped = STATUS_TABLE[normalized];
  if (mapped) return mapped;

  logger.warn(
    { bureau, rawStatus: normalized.slice(0, 40) },
    'unmapped bureau account status; recording as unknown',
  );
  return 'unknown';
}

export function clampScore(score: number | null | undefined): number | null {
  if (score === null || score === undefined || Number.isNaN(score)) return null;
  return Math.max(0, Math.min(999, Math.round(score)));
}
