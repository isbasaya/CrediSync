import { resolveEntities } from './resolver';
import { getScoreBand } from '../types';
import type { NormalizedBureauReport, ResolvedAccountCluster, UnifiedCreditProfile } from '../types';

const ADVERSE_STATUSES = new Set(['arrears', 'default', 'judgement', 'written_off']);

/**
 * Unified score = simple average of every bureau score that was actually
 * returned (thin-file bureaus with no score are excluded, not treated as
 * zero). This is intentionally the simplest defensible aggregation for
 * v1 — a bureau-reliability-weighted or ML-based aggregator can replace
 * this function without changing its signature, versioned via
 * entity_resolution_ver.
 */
function computeUnifiedScore(reports: NormalizedBureauReport[]): number | null {
  const scores = reports.map((r) => r.score).filter((s): s is number => s !== null);
  if (scores.length === 0) return null;
  const avg = scores.reduce((sum, s) => sum + s, 0) / scores.length;
  return Math.round(avg);
}

function scoreFor(reports: NormalizedBureauReport[], bureau: string): number | null {
  return reports.find((r) => r.bureau === bureau)?.score ?? null;
}

export function buildUnifiedProfile(
  reports: NormalizedBureauReport[],
  entityResolutionVersion = 1
): UnifiedCreditProfile {
  const resolvedClusters: ResolvedAccountCluster[] = resolveEntities(reports.map((r) => r.accounts));

  const openAccounts = resolvedClusters.filter((c) => c.canonical.closedDate === null).length;
  const adverseAccounts = resolvedClusters.filter((c) => ADVERSE_STATUSES.has(c.canonical.status)).length;
  const totalCreditExposure = resolvedClusters.reduce((sum, c) => sum + c.canonical.currentBalance, 0);
  const monthlyInstalment = resolvedClusters.reduce((sum, c) => sum + c.canonical.instalmentAmount, 0);

  // Judgements/defaults/enquiries come straight from each bureau's own
  // aggregate counts (not derivable from merged accounts, since a single
  // judgement can span records the resolver didn't cluster together).
  // Take the max across bureaus — the most conservative reading — since
  // under-reporting risk to the consumer is the worse failure mode.
  const judgementsCount = Math.max(0, ...reports.map((r) => r.judgementsCount));
  const defaultsCount = Math.max(0, ...reports.map((r) => r.defaultsCount));
  const enquiriesLast12m = Math.max(0, ...reports.map((r) => r.enquiriesLast12m));

  const unifiedScore = computeUnifiedScore(reports);

  const tuScore = scoreFor(reports, 'transunion');
  const exScore = scoreFor(reports, 'experian');
  const xdsScore = scoreFor(reports, 'xds');

  return {
    unifiedScore,
    unifiedScoreBand: unifiedScore !== null ? getScoreBand(unifiedScore) : null,
    entityResolutionVersion,

    transunionScore: tuScore,
    transunionScoreBand: tuScore !== null ? getScoreBand(tuScore) : null,
    experianScore: exScore,
    experianScoreBand: exScore !== null ? getScoreBand(exScore) : null,
    xdsScore,
    xdsScoreBand: xdsScore !== null ? getScoreBand(xdsScore) : null,

    totalAccounts: resolvedClusters.length,
    openAccounts,
    adverseAccounts,
    judgementsCount,
    defaultsCount,
    enquiriesLast12m,
    totalCreditExposure: Number(totalCreditExposure.toFixed(2)),
    monthlyInstalment: Number(monthlyInstalment.toFixed(2)),

    resolvedClusters,
  };
}
