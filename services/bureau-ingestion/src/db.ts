import type { Pool } from 'pg';
import { withUser, writeAudit } from '@credisync/db';
import { decryptFromBytes } from '@credisync/crypto';
import type { BankReadinessTier, BureauSource, ScoreBand, AccountStatus } from '@credisync/types';
import type { UnifiedCreditProfile } from './types';

export interface ConsumerIdentity {
  firstName: string;
  lastName: string;
  saIdNumber: string;
  isVerified: boolean;
  creditCheckConsent: boolean;
  lastRefreshAt: Date | null;
}

/** Loads what a bureau pull needs, decrypting the SA ID just-in-time. Never log the result. */
export async function loadConsumerIdentity(pool: Pool, userId: string): Promise<ConsumerIdentity | null> {
  const row = await withUser(pool, userId, async (client) => {
    const r = await client.query(
      `SELECT u.first_name, u.last_name, u.sa_id_encrypted, u.is_verified, u.credit_check_consent,
              (SELECT max(created_at) FROM credisync.credit_profiles cp WHERE cp.user_id = u.id) AS last_refresh_at
       FROM credisync.users u WHERE u.id = $1 AND u.is_active`,
      [userId]
    );
    return r.rows[0];
  });
  if (!row) return null;
  return {
    firstName: row.first_name,
    lastName: row.last_name,
    saIdNumber: await decryptFromBytes(row.sa_id_encrypted),
    isVerified: row.is_verified,
    creditCheckConsent: row.credit_check_consent,
    lastRefreshAt: row.last_refresh_at ? new Date(row.last_refresh_at) : null,
  };
}

const BUREAU_PRIORITY: Record<string, number> = { transunion: 0, experian: 1, xds: 2 };

/**
 * Persists a freshly computed unified profile in one transaction:
 *   1. supersede the current profile (is_current = FALSE)
 *   2. insert the new current profile
 *   3. insert one bureau_accounts row per bureau record, with that bureau's
 *      OWN figures (not the merged ones), linked by resolved_account_id
 */
export async function persistUnifiedProfile(
  pool: Pool,
  userId: string,
  profile: UnifiedCreditProfile,
  fetchedBureaus: BureauSource[]
): Promise<string> {
  return withUser(pool, userId, async (client) => {
    await client.query(
      'UPDATE credisync.credit_profiles SET is_current = FALSE WHERE user_id = $1 AND is_current = TRUE',
      [userId]
    );

    const fetched = (b: BureauSource) => fetchedBureaus.includes(b);
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO credisync.credit_profiles (
         user_id, unified_score, unified_score_band, entity_resolution_ver,
         transunion_score, transunion_score_band, transunion_fetched_at,
         experian_score, experian_score_band, experian_fetched_at,
         xds_score, xds_score_band, xds_fetched_at,
         total_accounts, open_accounts, adverse_accounts,
         judgements_count, defaults_count, enquiries_last_12m,
         total_credit_exposure, monthly_instalment,
         is_current, profile_version
       ) VALUES (
         $1, $2, $3, $4,
         $5, $6, CASE WHEN $7 THEN NOW() END,
         $8, $9, CASE WHEN $10 THEN NOW() END,
         $11, $12, CASE WHEN $13 THEN NOW() END,
         $14, $15, $16, $17, $18, $19, $20, $21,
         TRUE,
         COALESCE((SELECT MAX(profile_version) FROM credisync.credit_profiles WHERE user_id = $1), 0) + 1
       ) RETURNING id`,
      [
        userId,
        profile.unifiedScore,
        profile.unifiedScoreBand,
        profile.entityResolutionVersion,
        profile.transunionScore,
        profile.transunionScoreBand,
        fetched('transunion'),
        profile.experianScore,
        profile.experianScoreBand,
        fetched('experian'),
        profile.xdsScore,
        profile.xdsScoreBand,
        fetched('xds'),
        profile.totalAccounts,
        profile.openAccounts,
        profile.adverseAccounts,
        profile.judgementsCount,
        profile.defaultsCount,
        profile.enquiriesLast12m,
        profile.totalCreditExposure,
        profile.monthlyInstalment,
      ]
    );
    const creditProfileId = inserted.rows[0]!.id;

    let merges = 0;
    for (const cluster of profile.resolvedClusters) {
      if (cluster.members.length > 1) merges += 1;
      const ordered = [...cluster.members].sort(
        (a, b) => (BUREAU_PRIORITY[a.account.bureau] ?? 9) - (BUREAU_PRIORITY[b.account.bureau] ?? 9)
      );
      for (const [index, { account, confidence }] of ordered.entries()) {
        await client.query(
          `INSERT INTO credisync.bureau_accounts (
             credit_profile_id, user_id, bureau, account_reference, creditor_name, account_type,
             status, raw_status, opened_date, closed_date, credit_limit, current_balance,
             overdue_amount, instalment_amount, months_in_arrears, worst_status_12m,
             payment_profile, resolved_account_id, is_cluster_primary, resolution_confidence
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
          [
            creditProfileId,
            userId,
            account.bureau,
            account.accountReference,
            account.creditorName,
            account.accountType,
            account.status,
            account.rawStatus,
            account.openedDate,
            account.closedDate,
            account.creditLimit,
            account.currentBalance,
            account.overdueAmount,
            account.instalmentAmount,
            account.monthsInArrears,
            account.worstStatus12m,
            account.paymentProfile,
            cluster.resolvedAccountId,
            index === 0,
            confidence,
          ]
        );
      }
    }

    await writeAudit(client, {
      userId,
      eventType: 'score_computed',
      resourceType: 'credit_profile',
      resourceId: creditProfileId,
      payload: { unified_score: profile.unifiedScore, total_accounts: profile.totalAccounts, bureaus: fetchedBureaus },
    });
    if (merges > 0) {
      await writeAudit(client, {
        userId,
        eventType: 'ai_entity_merge',
        resourceType: 'credit_profile',
        resourceId: creditProfileId,
        payload: { merged_clusters: merges, resolver_version: profile.entityResolutionVersion },
      });
    }
    return creditProfileId;
  });
}

export async function logBureauPull(
  pool: Pool,
  userId: string,
  bureau: string,
  success: boolean,
  errorMessage?: string
): Promise<void> {
  await withUser(pool, userId, (client) =>
    writeAudit(client, {
      userId,
      eventType: 'bureau_pull',
      resourceType: 'credit_profile',
      success,
      errorMessage: errorMessage ?? null,
      payload: { bureau },
    })
  );
}

export interface CreditProfileSummary {
  id: string;
  userId: string;
  unifiedScore: number | null;
  unifiedScoreBand: ScoreBand | null;
  bureauScores: Array<{ bureau: BureauSource; score: number | null; scoreBand: ScoreBand | null; fetchedAt: string | null }>;
  totalAccounts: number;
  openAccounts: number;
  adverseAccounts: number;
  judgementsCount: number;
  defaultsCount: number;
  enquiriesLast12m: number;
  totalCreditExposure: number;
  monthlyInstalment: number;
  bankReadinessScore: number | null;
  bankReadinessTier: BankReadinessTier | null;
  lastRefreshedAt: string;
}

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

export async function getCurrentProfile(pool: Pool, userId: string): Promise<CreditProfileSummary | null> {
  return withUser(pool, userId, async (client) => {
    const r = await client.query('SELECT * FROM credisync.v_active_credit_profiles WHERE user_id = $1', [userId]);
    const p = r.rows[0];
    if (!p) return null;
    await writeAudit(client, { userId, eventType: 'data_access', resourceType: 'credit_profile', resourceId: p.id });
    return {
      id: p.id,
      userId: p.user_id,
      unifiedScore: p.unified_score,
      unifiedScoreBand: p.unified_score_band,
      bureauScores: (['transunion', 'experian', 'xds'] as const).map((bureau) => ({
        bureau,
        score: p[`${bureau}_score`],
        scoreBand: p[`${bureau}_score_band`],
        fetchedAt: iso(p[`${bureau}_fetched_at`]),
      })),
      totalAccounts: p.total_accounts,
      openAccounts: p.open_accounts,
      adverseAccounts: p.adverse_accounts,
      judgementsCount: p.judgements_count,
      defaultsCount: p.defaults_count,
      enquiriesLast12m: p.enquiries_last_12m,
      totalCreditExposure: Number(p.total_credit_exposure),
      monthlyInstalment: Number(p.monthly_instalment),
      bankReadinessScore: p.bank_readiness_score === null ? null : Number(p.bank_readiness_score),
      bankReadinessTier: p.bank_readiness_tier,
      lastRefreshedAt: iso(p.last_refreshed_at)!,
    };
  });
}

export interface BureauAccountSummary {
  id: string;
  resolvedAccountId: string;
  bureau: BureauSource;
  creditorName: string;
  accountType: string;
  status: AccountStatus;
  currentBalance: number;
  overdueAmount: number;
  monthsInArrears: number;
  /** Every bureau that reports this facility, with its own figures (dispute one of these). */
  reportedBy: Array<{ accountId: string; bureau: BureauSource; status: AccountStatus; currentBalance: number; overdueAmount: number }>;
}

export async function getCurrentAccounts(pool: Pool, userId: string): Promise<BureauAccountSummary[]> {
  return withUser(pool, userId, async (client) => {
    const r = await client.query(
      `SELECT ba.* FROM credisync.bureau_accounts ba
       JOIN credisync.credit_profiles cp ON cp.id = ba.credit_profile_id
       WHERE cp.user_id = $1 AND cp.is_current
       ORDER BY ba.resolved_account_id, ba.is_cluster_primary DESC`,
      [userId]
    );
    const clusters = new Map<string, BureauAccountSummary>();
    for (const row of r.rows) {
      const member = {
        accountId: row.id,
        bureau: row.bureau,
        status: row.status,
        currentBalance: Number(row.current_balance),
        overdueAmount: Number(row.overdue_amount),
      };
      const existing = clusters.get(row.resolved_account_id);
      if (existing) {
        existing.reportedBy.push(member);
        continue;
      }
      clusters.set(row.resolved_account_id, {
        id: row.id,
        resolvedAccountId: row.resolved_account_id,
        bureau: row.bureau,
        creditorName: row.creditor_name,
        accountType: row.account_type,
        status: row.status,
        currentBalance: Number(row.current_balance),
        overdueAmount: Number(row.overdue_amount),
        monthsInArrears: row.months_in_arrears,
        reportedBy: [member],
      });
    }
    const severity: Record<string, number> = { current: 0, unknown: 1, arrears: 2, default: 3, written_off: 4, judgement: 5 };
    return [...clusters.values()].map((c) => {
      const worst = [...c.reportedBy].sort((a, b) => (severity[b.status] ?? 0) - (severity[a.status] ?? 0))[0]!;
      return { ...c, status: worst.status };
    });
  });
}
