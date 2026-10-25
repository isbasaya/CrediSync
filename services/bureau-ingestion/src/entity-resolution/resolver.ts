import { createHash } from 'crypto';
import { accountTypeSimilarity, amountCloseness, creditorNameSimilarity, dateCloseness } from './similarity';
import type { NormalizedBureauAccount, ResolvedAccountCluster } from '../types';

/**
 * Entity Resolution Engine (v2 — deterministic weighted-feature matcher).
 *
 * The same real-world credit facility is often reported by 1–3 bureaus under
 * different account references and slightly different creditor names or
 * balances (reporting lag). Clustering them stops the same debt being
 * counted two or three times in a consumer's exposure.
 *
 * Rules:
 *   - never merge two accounts from the same bureau;
 *   - never merge accounts of clearly different product types (a bank's
 *     credit card and home loan share a creditor name but are different
 *     facilities);
 *   - otherwise score five signals and merge at >= MERGE_THRESHOLD.
 *
 * Input is sorted before matching so the result does not depend on the
 * order bureaus responded in, and cluster ids are derived from member
 * references so re-running on the same data gives the same ids.
 */

export const ENTITY_RESOLUTION_VERSION = 2;

const WEIGHTS = {
  creditorName: 0.35,
  accountType: 0.15,
  limit: 0.2,
  balance: 0.15,
  openedDate: 0.15,
} as const;

const MERGE_THRESHOLD = 0.72;
/** Below this, account types are treated as different products (hard block). */
const ACCOUNT_TYPE_BLOCK = 0.5;

const BUREAU_PRIORITY: Record<string, number> = { transunion: 0, experian: 1, xds: 2 };

export function pairScore(a: NormalizedBureauAccount, b: NormalizedBureauAccount): number {
  const typeScore = accountTypeSimilarity(a.accountType, b.accountType);
  if (typeScore < ACCOUNT_TYPE_BLOCK) return 0;

  const nameScore = creditorNameSimilarity(a.creditorName, b.creditorName);
  const limitScore =
    a.creditLimit !== null && b.creditLimit !== null ? amountCloseness(a.creditLimit, b.creditLimit) : 0.5;
  const balanceScore = amountCloseness(a.currentBalance, b.currentBalance);
  const dateScore = dateCloseness(a.openedDate, b.openedDate);

  return (
    nameScore * WEIGHTS.creditorName +
    typeScore * WEIGHTS.accountType +
    limitScore * WEIGHTS.limit +
    balanceScore * WEIGHTS.balance +
    dateScore * WEIGHTS.openedDate
  );
}

const STATUS_SEVERITY: Record<string, number> = {
  current: 0,
  unknown: 1,
  arrears: 2,
  default: 3,
  written_off: 4,
  judgement: 5,
};

/**
 * Canonical (merged) record for totals. Display fields come from the
 * highest-priority bureau; numeric fields and status take the most
 * conservative value so the unified view never understates exposure.
 */
function buildCanonical(members: NormalizedBureauAccount[]): NormalizedBureauAccount {
  const primary = members[0]!;
  const worst = [...members].sort((a, b) => (STATUS_SEVERITY[b.status] ?? 0) - (STATUS_SEVERITY[a.status] ?? 0))[0]!;
  const limits = members.map((m) => m.creditLimit).filter((l): l is number => l !== null);

  return {
    ...primary,
    status: worst.status,
    currentBalance: Math.max(...members.map((m) => m.currentBalance)),
    overdueAmount: Math.max(...members.map((m) => m.overdueAmount)),
    instalmentAmount: Math.max(...members.map((m) => m.instalmentAmount)),
    monthsInArrears: Math.max(...members.map((m) => m.monthsInArrears)),
    creditLimit: limits.length > 0 ? Math.max(...limits) : null,
    closedDate: members.every((m) => m.closedDate !== null) ? primary.closedDate : null,
  };
}

function clusterId(members: NormalizedBureauAccount[]): string {
  const key = members
    .map((m) => `${m.bureau}:${m.accountReference}`)
    .sort()
    .join('|');
  const h = createHash('sha256').update(key).digest('hex');
  // Format as a UUID (v4 layout bits) so it fits the uuid column.
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function sortKey(a: NormalizedBureauAccount): string {
  return `${BUREAU_PRIORITY[a.bureau] ?? 9}|${a.accountReference}`;
}

export function resolveEntities(accountsByBureau: NormalizedBureauAccount[][]): ResolvedAccountCluster[] {
  const accounts = accountsByBureau.flat().sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  const clusters: NormalizedBureauAccount[][] = [];

  for (const candidate of accounts) {
    let bestCluster: NormalizedBureauAccount[] | null = null;
    let bestScore = 0;

    for (const cluster of clusters) {
      if (cluster.some((m) => m.bureau === candidate.bureau)) continue;
      const score = Math.max(...cluster.map((m) => pairScore(m, candidate)));
      if (score > bestScore) {
        bestScore = score;
        bestCluster = cluster;
      }
    }

    if (bestCluster && bestScore >= MERGE_THRESHOLD) bestCluster.push(candidate);
    else clusters.push([candidate]);
  }

  return clusters.map((members): ResolvedAccountCluster => {
    const canonical = buildCanonical(members);
    return {
      resolvedAccountId: clusterId(members),
      members: members.map((account) => ({
        account,
        confidence: members.length === 1 ? 1 : Number(pairScore(account, canonical).toFixed(3)),
      })),
      canonical,
    };
  });
}
