import type { NormalizedAccountFeed } from '../types';

export interface OpenBankingFetchRequest {
  userId: string;
  accountLinkToken: string; // provider-issued token from the consent/link flow, never a raw bank credential
  periodStart: string; // ISO date
  periodEnd: string; // ISO date
}

export interface OpenBankingAdapter {
  readonly source: NormalizedAccountFeed['source'];
  fetchTransactions(request: OpenBankingFetchRequest): Promise<NormalizedAccountFeed>;
}

export class OpenBankingFetchError extends Error {
  constructor(
    public readonly source: string,
    public readonly cause: 'timeout' | 'auth' | 'consent_revoked' | 'upstream_error',
    message: string,
  ) {
    super(`[${source}] ${cause}: ${message}`);
    this.name = 'OpenBankingFetchError';
  }
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 10_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
