import { Pool } from 'pg';
import type { UnifiedCreditProfile } from './types';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
});

/**
 * Persists a freshly computed unified profile:
 *   1. Mark the user's current profile row as superseded (is_current = FALSE)
 *   2. Insert the new profile row as the current one
 *   3. Insert one bureau_accounts row per resolved cluster member
 * Runs inside a transaction so a partial write never leaves a user with
 * zero current profiles.
 */
export async function persistUnifiedProfile(userId: string, profile: UnifiedCreditProfile): Promise<string> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL app.current_user_id = $1', [userId]);

    await client.query(
      `UPDATE credisync.credit_profiles SET is_current = FALSE WHERE user_id = $1 AND is_current = TRUE`,
      [userId]
    );

    const insertProfile = await client.query<{ id: string }>(
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
         $5, $6, CASE WHEN $5 IS NOT NULL THEN NOW() END,
         $7, $8, CASE WHEN $7 IS NOT NULL THEN NOW() END,
         $9, $10, CASE WHEN $9 IS NOT NULL THEN NOW() END,
         $11, $12, $13,
         $14, $15, $16,
         $17, $18,
         TRUE,
         COALESCE((SELECT MAX(profile_version) FROM credisync.credit_profiles WHERE user_id = $1), 0) + 1
       )
       RETURNING id`,
      [
        userId,
        profile.unifiedScore,
        profile.unifiedScoreBand,
        profile.entityResolutionVersion,
        profile.transunionScore,
        profile.transunionScoreBand,
        profile.experianScore,
        profile.experianScoreBand,
        profile.xdsScore,
        profile.xdsScoreBand,
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

    const creditProfileId = insertProfile.rows[0]!.id;

    for (const cluster of profile.resolvedClusters) {
      for (const member of cluster.members) {
        const { canonical } = cluster;
        await client.query(
          `INSERT INTO credisync.bureau_accounts (
             credit_profile_id, bureau, account_reference, creditor_name, account_type,
             status, opened_date, closed_date, credit_limit, current_balance,
             overdue_amount, instalment_amount, months_in_arrears, worst_status_12m,
             payment_profile, resolved_account_id, resolution_confidence
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
           ON CONFLICT (credit_profile_id, bureau, account_reference) DO UPDATE SET
             status = EXCLUDED.status,
             current_balance = EXCLUDED.current_balance,
             overdue_amount = EXCLUDED.overdue_amount,
             months_in_arrears = EXCLUDED.months_in_arrears,
             resolved_account_id = EXCLUDED.resolved_account_id,
             resolution_confidence = EXCLUDED.resolution_confidence`,
          [
            creditProfileId,
            member.bureau,
            member.accountReference,
            canonical.creditorName,
            canonical.accountType,
            canonical.status,
            canonical.openedDate,
            canonical.closedDate,
            canonical.creditLimit,
            canonical.currentBalance,
            canonical.overdueAmount,
            canonical.instalmentAmount,
            canonical.monthsInArrears,
            canonical.worstStatus12m,
            canonical.paymentProfile,
            cluster.resolvedAccountId,
            member.confidence,
          ]
        );
      }
    }

    await client.query(
      `INSERT INTO credisync.regulatory_audit_logs (user_id, event_type, resource_type, resource_id, payload)
       VALUES ($1, 'score_computed', 'credit_profile', $2, $3::jsonb)`,
      [userId, creditProfileId, JSON.stringify({ unified_score: profile.unifiedScore, total_accounts: profile.totalAccounts })]
    );

    await client.query('COMMIT');
    return creditProfileId;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
