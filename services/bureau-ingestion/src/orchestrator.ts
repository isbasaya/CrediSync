import type { Pool } from 'pg';
import pino from 'pino';
import { TransUnionAdapter } from './adapters/transunion.adapter';
import { ExperianAdapter } from './adapters/experian.adapter';
import { XdsAdapter } from './adapters/xds.adapter';
import { SandboxBureauAdapter } from './adapters/sandbox.adapter';
import { BureauFetchError, type BureauAdapter } from './adapters/bureau-adapter.interface';
import { isCircuitOpen, recordFailure, recordSuccess } from './circuit-breaker';
import { buildUnifiedProfile } from './entity-resolution/merge';
import { loadScoreRanges } from './entity-resolution/score-normalisation';
import { loadConsumerIdentity, logBureauPull, persistUnifiedProfile } from './db';
import type { BureauSource, NormalizedBureauReport, UnifiedCreditProfile } from './types';

const logger = pino({ name: 'bureau-ingestion' });

/** Bureau pulls cost money and can show as enquiries; allow one refresh per user per window. */
export const REFRESH_COOLDOWN_MS = Number(process.env.BUREAU_REFRESH_COOLDOWN_MS ?? 60 * 60 * 1000);

export function createAdapters(env: NodeJS.ProcessEnv = process.env): BureauAdapter[] {
  if (env.BUREAU_MODE === 'sandbox') {
    return (['transunion', 'experian', 'xds'] as const).map((b) => new SandboxBureauAdapter(b));
  }
  return [new TransUnionAdapter(), new ExperianAdapter(), new XdsAdapter()];
}

export class RefreshRefusedError extends Error {
  constructor(
    public readonly code: 'not_found' | 'email_not_verified' | 'credit_check_consent_required' | 'refresh_too_soon',
    public readonly status: number,
    message: string,
    public readonly retryAfterSeconds?: number
  ) {
    super(message);
    this.name = 'RefreshRefusedError';
  }
}

export interface RefreshResult {
  creditProfileId: string;
  profile: UnifiedCreditProfile;
  bureauFailures: Array<{ bureau: string; reason: string; retryable: boolean }>;
}

/**
 * Fetches all bureaus in parallel, tolerates partial failure (a thin file at
 * one bureau, or one bureau down, must not block the others), merges via
 * entity resolution and persists the result.
 *
 * Preconditions enforced here (not only at the gateway): the user exists,
 * has verified their email, has granted credit-check consent, and has not
 * refreshed within the cooldown window.
 */
export async function refreshCreditProfile(
  pool: Pool,
  userId: string,
  adapters: BureauAdapter[] = createAdapters()
): Promise<RefreshResult> {
  const identity = await loadConsumerIdentity(pool, userId);
  if (!identity) throw new RefreshRefusedError('not_found', 404, 'User not found');
  if (!identity.isVerified) {
    throw new RefreshRefusedError('email_not_verified', 403, 'Verify your email address before we fetch your credit reports');
  }
  if (!identity.creditCheckConsent) {
    throw new RefreshRefusedError(
      'credit_check_consent_required',
      403,
      'Give permission for CrediSync to request your credit reports first'
    );
  }
  if (identity.lastRefreshAt) {
    const elapsed = Date.now() - identity.lastRefreshAt.getTime();
    if (elapsed < REFRESH_COOLDOWN_MS) {
      const retryAfter = Math.ceil((REFRESH_COOLDOWN_MS - elapsed) / 1000);
      throw new RefreshRefusedError('refresh_too_soon', 429, 'Your reports were refreshed recently. Try again later.', retryAfter);
    }
  }

  const request = {
    userId,
    saIdNumber: identity.saIdNumber,
    firstName: identity.firstName,
    lastName: identity.lastName,
  };

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

  for (const [i, result] of results.entries()) {
    const bureau = adapters[i]!.bureau;
    if (result.status === 'fulfilled') {
      reports.push(result.value);
      await logBureauPull(pool, userId, bureau, true);
    } else {
      const err = result.reason;
      // Error text is ours (BureauFetchError) or generic; never include request data.
      const reason = err instanceof BureauFetchError ? err.message : 'unexpected error';
      bureauFailures.push({ bureau, reason, retryable: err instanceof BureauFetchError ? err.retryable : true });
      await logBureauPull(pool, userId, bureau, false, reason);
      if (!(err instanceof BureauFetchError)) logger.error({ bureau, err: String(err).slice(0, 200) }, 'bureau adapter failed');
    }
  }

  if (reports.length === 0) {
    throw new Error(`All bureau fetches failed: ${bureauFailures.map((f) => `${f.bureau}=${f.reason}`).join(', ')}`);
  }

  const profile = buildUnifiedProfile(reports, loadScoreRanges());
  const creditProfileId = await persistUnifiedProfile(
    pool,
    userId,
    profile,
    reports.map((r) => r.bureau as BureauSource)
  );
  return { creditProfileId, profile, bureauFailures };
}
