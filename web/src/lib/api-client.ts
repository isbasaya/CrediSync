import type { BureauAccountSummary, CreditProfileSummary } from './types';

/**
 * Thin typed client for the API gateway. The gateway (not built in this
 * step) is responsible for auth, POPIA consent checks, and fanning out to
 * the bureau-ingestion / dispute-engine / open-banking / bank-readiness
 * services — the browser never talks to those services directly.
 */
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    credentials: 'include',
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new ApiError(response.status, body || `Request to ${path} failed with ${response.status}`);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function getCreditProfile(userId: string): Promise<CreditProfileSummary> {
  return request<CreditProfileSummary>(`/credit-profiles/${userId}`);
}

export function getBureauAccounts(creditProfileId: string): Promise<BureauAccountSummary[]> {
  return request<BureauAccountSummary[]>(`/credit-profiles/${creditProfileId}/accounts`);
}

export function refreshCreditProfile(userId: string): Promise<CreditProfileSummary> {
  return request<CreditProfileSummary>(`/credit-profiles/${userId}/refresh`, { method: 'POST' });
}
