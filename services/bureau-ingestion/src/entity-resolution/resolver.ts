import { randomUUID } from 'crypto';
import { creditorNameSimilarity, amountCloseness, dateCloseness } from './similarity';
import type { NormalizedBureauAccount, ResolvedAccountCluster } from '../types';

/**
 * AI Entity Resolution Engine (v1 — deterministic weighted-feature matcher).
 *
 * Same real-world credit facility is frequently reported by 1-3 bureaus
 * under different account references, and sometimes slightly different
 * creditor names / balances (reporting lag). This clusters accounts that
 * likely represent the same facility so the UI shows one line item with
 * per-bureau provenance, instead of duplicating debt 2-3x in a user's
 * exposure totals.
 *
 * Matching is same-bureau-exclusive (an account never merges with another
 * account from the same bureau) and weighted across four signals:
 *   - creditor name similarity   (0.40) — strongest signal, least noisy
 *   - opening balance/limit      (0.25) — bureaus report near-identical limits
 *   - current balance closeness  (0.20) — drifts with reporting lag, lower weight
 *   - opened-date closeness      (0.15) — bureaus sometimes report onboarding date differently
 *
 * A pair merges when weightedScore >= MERGE_THRESHOLD. This is a
 * deterministic, auditable v1; `entity_resolution_ver` in credit_profiles
 * exists precisely so a future ML-based resolver (Python, trained on
 * confirmed-merge labels) can be versioned in without breaking historical
 * profiles.
 */

const WEIGHTS = {
  creditorName: 0.4,
  limit: 0.25,
  balance: 0.2,
  openedDate: 0.15,
} as const;

const MERGE_THRESHOLD = 0.72;

interface TaggedAccount {
  account: NormalizedBureauAccount;
  bureauIndex: number; // index into the input array, used to forbid same-bureau merges
}

function pairScore(a: NormalizedBureauAccount, b: NormalizedBureauAccount): number {
  const nameScore = creditorNameSimilarity(a.creditorName, b.creditorName);
  const limitScore =
    a.creditLimit !== null && b.creditLimit !== null ? amountCloseness(a.creditLimit, b.creditLimit) : 0.5;
  const balanceScore = amountCloseness(a.currentBalance, b.currentBalance);
  const dateScore = dateCloseness(a.openedDate, b.openedDate);

  return (
    nameScore * WEIGHTS.creditorName +
    limitScore * WEIGHTS.limit +
    balanceScore * WEIGHTS.balance +
    dateScore * WEIGHTS.openedDate
  );
}

/** Builds the canonical (merged) record for a cluster, preferring the most recently reported values. */
function buildCanonical(members: NormalizedBureauAccount[]): NormalizedBureauAccount {
  // Prefer TransUnion > Experian > XDS as tie-break for display fields when
  // values differ trivially (e.g. "ABSA" vs "ABSA Bank") — arbitrary but
  // stable, and documented so product/compliance can override deliberately.
  const priority: Record<string, number> = { transunion: 0, experian: 1, xds: 2 };
  const sorted = [...members].sort((a, b) => priority[a.bureau] - priority[b.bureau]);
  const primary = sorted[0]!;

  return {
    ...primary,
    // Numeric fields: take the most conservative (highest risk) figure
    // across bureaus rather than averaging, so the unified profile never
    // understates a consumer's exposure or arrears.
    currentBalance: Math.max(...members.map((m) => m.currentBalance)),
    overdueAmount: Math.max(...members.map((m) => m.overdueAmount)),
    monthsInArrears: Math.max(...members.map((m) => m.monthsInArrears)),
    creditLimit: members.some((m) => m.creditLimit !== null)
      ? Math.max(...members.filter((m) => m.creditLimit !== null).map((m) => m.creditLimit!))
      : null,
  };
}

export function resolveEntities(accountsByBureau: NormalizedBureauAccount[][]): ResolvedAccountCluster[] {
  const tagged: TaggedAccount[] = accountsByBureau.flatMap((accounts, bureauIndex) =>
    accounts.map((account) => ({ account, bureauIndex }))
  );

  const clusters: TaggedAccount[][] = [];

  for (const candidate of tagged) {
    let bestCluster: TaggedAccount[] | null = null;
    let bestScore = 0;

    for (const cluster of clusters) {
      const alreadyHasBureau = cluster.some((m) => m.bureauIndex === candidate.bureauIndex);
      if (alreadyHasBureau) continue;

      // Score against the cluster's best-matching existing member.
      const scoreAgainstCluster = Math.max(...cluster.map((m) => pairScore(m.account, candidate.account)));
      if (scoreAgainstCluster > bestScore) {
        bestScore = scoreAgainstCluster;
        bestCluster = cluster;
      }
    }

    if (bestCluster && bestScore >= MERGE_THRESHOLD) {
      bestCluster.push(candidate);
    } else {
      clusters.push([candidate]);
    }
  }

  return clusters.map((cluster): ResolvedAccountCluster => {
    const members = cluster.map((c) => c.account);
    const canonical = buildCanonical(members);

    // Confidence per member = its similarity to the canonical record;
    // singleton clusters (unmatched, single-bureau accounts) get 1.0 since
    // there's nothing to disambiguate.
    return {
      resolvedAccountId: randomUUID(),
      members: cluster.map((c) => ({
        bureau: c.account.bureau,
        accountReference: c.account.accountReference,
        confidence: members.length === 1 ? 1 : Number(pairScore(c.account, canonical).toFixed(3)),
      })),
      canonical,
    };
  });
}
