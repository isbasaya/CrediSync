import type { BureauSource } from '../types';

/**
 * Each bureau publishes its score on its own scale with its own cut-offs,
 * so averaging raw numbers is not meaningful. Each score is first mapped
 * onto a common 0–999 scale using that bureau's published range, then
 * averaged.
 *
 * The ranges below are PLACEHOLDERS (0–999 for all three) until the signed
 * bureau contracts confirm each product's range. Configure without a code
 * change via BUREAU_SCORE_RANGES, e.g.
 *   BUREAU_SCORE_RANGES='{"transunion":[0,999],"experian":[0,999],"xds":[0,999]}'
 */
export type ScoreRanges = Record<BureauSource, readonly [min: number, max: number]>;

export const DEFAULT_SCORE_RANGES: ScoreRanges = {
  transunion: [0, 999],
  experian: [0, 999],
  xds: [0, 999],
};

export function loadScoreRanges(env: NodeJS.ProcessEnv = process.env): ScoreRanges {
  if (!env.BUREAU_SCORE_RANGES) return DEFAULT_SCORE_RANGES;
  const parsed = JSON.parse(env.BUREAU_SCORE_RANGES) as Partial<
    Record<BureauSource, [number, number]>
  >;
  const ranges = { ...DEFAULT_SCORE_RANGES };
  for (const bureau of Object.keys(ranges) as BureauSource[]) {
    const r = parsed[bureau];
    if (r) {
      if (!(Array.isArray(r) && r.length === 2 && r[1] > r[0])) {
        throw new Error(`BUREAU_SCORE_RANGES.${bureau} must be [min, max] with max > min`);
      }
      ranges[bureau] = [r[0], r[1]];
    }
  }
  return ranges;
}

/** Maps a bureau's raw score onto the common 0–999 scale. */
export function normaliseScore(
  bureau: BureauSource,
  score: number,
  ranges: ScoreRanges = DEFAULT_SCORE_RANGES,
): number {
  const [min, max] = ranges[bureau];
  const ratio = (Math.min(max, Math.max(min, score)) - min) / (max - min);
  return Math.round(ratio * 999);
}
