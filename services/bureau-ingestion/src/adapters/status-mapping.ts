import type { AccountStatus } from '../types';

/**
 * Every bureau reports account status using its own vocabulary. This maps
 * each bureau's raw status strings to our canonical AccountStatus enum,
 * which is the single source of truth shared with db/schema.sql and
 * design-system/tokens.ts.
 *
 * NOTE: the raw string keys below are placeholders for the field values
 * documented in each bureau's real API contract (obtained under NDA once
 * the bureau integration agreement is signed) — swap them in per bureau
 * without touching any downstream code, since everything past this
 * function only ever sees AccountStatus.
 */
export function mapBureauStatus(bureau: string, rawStatus: string): AccountStatus {
  const normalized = rawStatus.trim().toLowerCase();

  const table: Record<string, AccountStatus> = {
    // Common / generic
    current: 'current',
    up_to_date: 'current',
    performing: 'current',
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

  const mapped = table[normalized];
  if (mapped) return mapped;

  // Fail safe: an unmapped upstream status must never silently become
  // 'current' (that would understate risk). Default to the most
  // conservative interpretation and let downstream monitoring flag it.
  console.warn(`[bureau-ingestion] unmapped status "${rawStatus}" from ${bureau}; defaulting to 'arrears'`);
  return 'arrears';
}

export function clampScore(score: number | null | undefined): number | null {
  if (score === null || score === undefined || Number.isNaN(score)) return null;
  return Math.max(0, Math.min(999, Math.round(score)));
}
