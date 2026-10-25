import { ADVERSE_ACCOUNT_STATUSES } from '@credisync/types';
import { ENTITY_RESOLUTION_VERSION, resolveEntities } from './resolver';
import { DEFAULT_SCORE_RANGES, normaliseScore, type ScoreRanges } from './score-normalisation';
import { getScoreBand } from '../types';
import type { BureauSource, NormalizedBureauReport, UnifiedCreditProfile } from '../types';

/**
 * Unified score = mean of the bureau scores that were returned, each first
 * mapped onto the common 0–999 scale (see score-normalisation.ts). Bureaus
 * with no score (thin file) are excluded rather than treated as zero.
 * Per-bureau scores are stored as reported; their bands use the same
 * normalised value so the colour shown matches the unified scale.
 */
function computeUnifiedScore(reports: NormalizedBureauReport[], ranges: ScoreRanges): number | null {
  const scores = reports
    .filter((r): r is NormalizedBureauReport & { score: number } => r.score !== null)
    .map((r) => normaliseScore(r.bureau, r.score, ranges));
  if (scores.length === 0) return null;
  return Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length);
}

export function buildUnifiedProfile(
  reports: NormalizedBureauReport[],
  ranges: ScoreRanges = DEFAULT_SCORE_RANGES
): UnifiedCreditProfile {
  const resolvedClusters = resolveEntities(reports.map((r) => r.accounts));
  const canonical = resolvedClusters.map((c) => c.canonical);

  const scoreFor = (bureau: BureauSource) => reports.find((r) => r.bureau === bureau)?.score ?? null;
  const bandFor = (bureau: BureauSource) => {
    const s = scoreFor(bureau);
    return s === null ? null : getScoreBand(normaliseScore(bureau, s, ranges));
  };

  const unifiedScore = computeUnifiedScore(reports, ranges);

  return {
    unifiedScore,
    unifiedScoreBand: unifiedScore !== null ? getScoreBand(unifiedScore) : null,
    entityResolutionVersion: ENTITY_RESOLUTION_VERSION,

    transunionScore: scoreFor('transunion'),
    transunionScoreBand: bandFor('transunion'),
    experianScore: scoreFor('experian'),
    experianScoreBand: bandFor('experian'),
    xdsScore: scoreFor('xds'),
    xdsScoreBand: bandFor('xds'),

    totalAccounts: canonical.length,
    openAccounts: canonical.filter((a) => a.closedDate === null).length,
    adverseAccounts: canonical.filter((a) => ADVERSE_ACCOUNT_STATUSES.has(a.status)).length,
    // Bureau aggregates can't be derived from merged accounts (one judgement
    // may span records the resolver kept apart). Take the max across bureaus:
    // the most conservative reading.
    judgementsCount: Math.max(0, ...reports.map((r) => r.judgementsCount)),
    defaultsCount: Math.max(0, ...reports.map((r) => r.defaultsCount)),
    enquiriesLast12m: Math.max(0, ...reports.map((r) => r.enquiriesLast12m)),
    totalCreditExposure: Number(canonical.reduce((sum, a) => sum + a.currentBalance, 0).toFixed(2)),
    monthlyInstalment: Number(canonical.reduce((sum, a) => sum + a.instalmentAmount, 0).toFixed(2)),

    resolvedClusters,
  };
}
