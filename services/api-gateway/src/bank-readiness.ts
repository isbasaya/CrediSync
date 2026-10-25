import type { Pool } from 'pg';
import { withUser, writeAudit } from '@credisync/db';
import { internalHeaders } from '@credisync/middleware';
import { UpstreamError } from './proxy';

export class ReadinessError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'ReadinessError';
  }
}

export interface ReadinessFeatures {
  unified_score: number | null;
  adverse_accounts: number;
  judgements_count: number;
  defaults_count: number;
  enquiries_last_12m: number;
  total_credit_exposure: number;
  monthly_instalment: number;
  net_income: number;
  debt_to_income_ratio: number | null;
  savings_rate: number | null;
  income_regularity_score: number | null;
  affordability_surplus: number | null;
  overdraft_days_30d: number;
  returned_debit_count: number;
}

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/**
 * Builds the scorer input from the user's CURRENT credit profile and latest
 * bank snapshot. Never from the request body — a client could otherwise
 * award itself a "prime" tier.
 *
 * Debt-to-income uses the larger of the bank-observed debt repayments and
 * the bureau-reported monthly instalments, so debt paid from another
 * account is not missed.
 */
export function toFeatures(profile: Record<string, unknown>, snapshot: Record<string, unknown> | null): ReadinessFeatures {
  const netIncome = snapshot ? num(snapshot.net_income) : 0;
  const bureauInstalment = num(profile.monthly_instalment);
  const bankDebt = snapshot ? num(snapshot.debt_repayment_total) : 0;
  const dti = netIncome > 0 ? Math.max(bureauInstalment, bankDebt) / netIncome : null;

  return {
    unified_score: numOrNull(profile.unified_score),
    adverse_accounts: num(profile.adverse_accounts),
    judgements_count: num(profile.judgements_count),
    defaults_count: num(profile.defaults_count),
    enquiries_last_12m: num(profile.enquiries_last_12m),
    total_credit_exposure: num(profile.total_credit_exposure),
    monthly_instalment: bureauInstalment,
    net_income: netIncome,
    debt_to_income_ratio: dti === null ? null : Number(dti.toFixed(4)),
    savings_rate: snapshot ? numOrNull(snapshot.savings_rate) : null,
    income_regularity_score: snapshot ? numOrNull(snapshot.income_regularity_score) : null,
    affordability_surplus: snapshot ? numOrNull(snapshot.affordability_surplus) : null,
    overdraft_days_30d: snapshot ? Math.min(30, num(snapshot.overdraft_days_30d)) : 0,
    returned_debit_count: snapshot ? num(snapshot.returned_debit_count) : 0,
  };
}

export interface ReadinessResult {
  score: number;
  tier: string;
  breakdown: Record<string, unknown>;
  top_reasons: string[];
  model_version: string;
}

export async function scoreBankReadiness(pool: Pool, scorerUrl: string, userId: string, traceId?: string) {
  const inputs = await withUser(pool, userId, async (client) => {
    const profile = await client.query('SELECT * FROM credisync.credit_profiles WHERE user_id = $1 AND is_current', [userId]);
    const snapshot = await client.query(
      'SELECT * FROM credisync.financial_health_snapshots WHERE user_id = $1 ORDER BY period_end DESC, created_at DESC LIMIT 1',
      [userId]
    );
    return { profile: profile.rows[0], snapshot: snapshot.rows[0] ?? null };
  });
  if (!inputs.profile) {
    throw new ReadinessError(409, 'no_credit_profile', 'Fetch your credit reports before calculating bank readiness');
  }

  const features = toFeatures(inputs.profile, inputs.snapshot);
  let response: globalThis.Response;
  try {
    response = await fetch(`${scorerUrl}/score`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...internalHeaders(undefined, traceId) },
      body: JSON.stringify(features),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new UpstreamError(502, 'scorer_unavailable');
  }
  if (!response.ok) throw new UpstreamError(502, `scorer_error_${response.status}`);
  const result = (await response.json()) as ReadinessResult;

  await withUser(pool, userId, async (client) => {
    await client.query(
      `UPDATE credisync.credit_profiles
       SET bank_readiness_score = $2, bank_readiness_tier = $3, bank_readiness_model = $4, bank_readiness_scored_at = NOW()
       WHERE id = $1`,
      [inputs.profile.id, result.score, result.tier, result.model_version]
    );
    await writeAudit(client, {
      userId,
      eventType: 'bank_readiness_scored',
      resourceType: 'credit_profile',
      resourceId: inputs.profile.id,
      payload: { score: result.score, tier: result.tier, model: result.model_version, has_bank_data: inputs.snapshot !== null },
    });
  });

  return { ...result, usedBankData: inputs.snapshot !== null };
}
