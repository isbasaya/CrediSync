import { TransUnionAdapter } from './adapters/transunion.adapter';
import { ExperianAdapter } from './adapters/experian.adapter';
import { XdsAdapter } from './adapters/xds.adapter';
import { BureauFetchError } from './adapters/bureau-adapter.interface';
import { isCircuitOpen, recordSuccess, recordFailure } from './circuit-breaker';
import { buildUnifiedProfile } from './entity-resolution/merge';
import { persistUnifiedProfile, pool } from './db';
import type { BureauAdapter } from './adapters/bureau-adapter.interface';
import type { BureauFetchRequest, NormalizedBureauReport, UnifiedCreditProfile } from './types';

const adapters: BureauAdapter[] = [new TransUnionAdapter(), new ExperianAdapter(), new XdsAdapter()];

export interface RefreshResult {
  creditProfileId: string;
  profile: UnifiedCreditProfile;
  bureauFailures: Array<{ bureau: string; reason: string; retryable: boolean }>;
}

/**
 * Fetches all three bureaus in parallel, tolerates partial failure (a
 * consumer can have a thin file at one bureau, or a bureau can be
 * temporarily down — that must not block the other two from refreshing),
 * merges via entity resolution, and persists the result.
 */
export async function refreshCreditProfile(request: BureauFetchRequest): Promise<RefreshResult> {
  const results = await Promise.allSettled(
    adapters.map(async (adapter): Promise<NormalizedBureauReport> => {
      if (isCircuitOpen(adapter.bureau)) {
        throw new BureauFetchError(adapter.bureau, 'upstream_error', 'circuit breaker open', true);
      }
      try {
        const report = await adapter.fetchReport(request);
        recordSuccess(adapter.bureau);
        return report;
      } catch (err) {
        recordFailure(adapter.bureau);
        throw err;
      }
    })
  );

  const reports: NormalizedBureauReport[] = [];
  const bureauFailures: RefreshResult['bureauFailures'] = [];

  results.forEach((result, i) => {
    const bureau = adapters[i]!.bureau;
    if (result.status === 'fulfilled') {
      reports.push(result.value);
      logBureauPull(request.userId, bureau, true).catch(() => {});
    } else {
      const err = result.reason;
      const isFetchError = err instanceof BureauFetchError;
      bureauFailures.push({
        bureau,
        reason: isFetchError ? err.message : String(err),
        retryable: isFetchError ? err.retryable : true,
      });
      logBureauPull(request.userId, bureau, false, isFetchError ? err.message : String(err)).catch(() => {});
    }
  });

  if (reports.length === 0) {
    throw new Error(
      `All bureau fetches failed for user ${request.userId}: ${bureauFailures.map((f) => `${f.bureau}=${f.reason}`).join(', ')}`
    );
  }

  const profile = buildUnifiedProfile(reports);
  const creditProfileId = await persistUnifiedProfile(request.userId, profile);

  return { creditProfileId, profile, bureauFailures };
}

async function logBureauPull(userId: string, bureau: string, success: boolean, errorMessage?: string): Promise<void> {
  await pool.query(
    `INSERT INTO credisync.regulatory_audit_logs (user_id, event_type, resource_type, success, error_message, payload)
     VALUES ($1, 'bureau_pull', 'credit_profile', $2, $3, $4::jsonb)`,
    [userId, success, errorMessage ?? null, JSON.stringify({ bureau })]
  );
}
