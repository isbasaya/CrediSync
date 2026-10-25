import type { BureauFetchRequest, NormalizedBureauReport } from '../types';

/**
 * Every bureau integration (TransUnion, Experian, XDS, and any future
 * bureau) implements this interface. The orchestrator never depends on
 * bureau-specific payload shapes — only on `NormalizedBureauReport`.
 *
 * Adapters are responsible for:
 *  - Authenticating against the bureau's API (mTLS / OAuth2 per bureau contract)
 *  - Mapping the bureau's proprietary response schema to NormalizedBureauReport
 *  - Raising BureauFetchError (never a raw HTTP error) so the orchestrator
 *    can apply uniform retry/circuit-breaker/partial-failure handling
 */
export interface BureauAdapter {
  readonly bureau: NormalizedBureauReport['bureau'];
  fetchReport(request: BureauFetchRequest): Promise<NormalizedBureauReport>;
}

export class BureauFetchError extends Error {
  constructor(
    public readonly bureau: string,
    public readonly cause: 'timeout' | 'auth' | 'not_found' | 'rate_limited' | 'upstream_error',
    message: string,
    public readonly retryable: boolean
  ) {
    super(`[${bureau}] ${cause}: ${message}`);
    this.name = 'BureauFetchError';
  }
}

/**
 * Shared HTTP helper: fixed timeout + single retry on transient failure.
 * Bureau contracts are B2B and rate-limited, so adapters must never hammer
 * the upstream on failure — the orchestrator's circuit breaker (see
 * orchestrator.ts) handles sustained outages at the fleet level.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 8000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
