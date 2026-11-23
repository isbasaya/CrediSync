import type {
  BureauAccountSummary,
  CreditProfileSummary,
  Dispute,
  DisputeReason,
  Me,
  RefreshResponse,
} from './types';

/**
 * Typed client for the API gateway. The session lives in httpOnly cookies
 * set by the gateway, so this code never sees or stores a token. A 401
 * triggers one silent refresh (rotating the refresh cookie) and a retry.
 */
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api';

/** Direct link (cookie-authenticated) to download a dispute letter as PDF. */
export const disputeLetterUrl = (id: string) =>
  `${API_BASE_URL}/disputes/${encodeURIComponent(id)}/letter.pdf`;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Plain-language messages for codes the user can act on. */
const FRIENDLY: Record<string, string> = {
  invalid_credentials:
    'That email and password don’t match, or the account is temporarily locked. Try again in 15 minutes.',
  account_exists: 'An account already exists for these details. Try signing in instead.',
  invalid_sa_id: 'That South African ID number isn’t valid. Check the 13 digits and try again.',
  email_not_verified: 'Confirm your email address first — we sent you a link when you signed up.',
  credit_check_consent_required:
    'Give CrediSync permission to request your credit reports first (Privacy settings).',
  refresh_too_soon: 'Your reports were refreshed recently. You can refresh again in about an hour.',
  open_banking_consent_required:
    'Give permission to read your bank transactions first (Privacy settings).',
  invalid_state: 'That bank connection attempt expired. Please start again.',
  link_expired: 'Your bank connection has expired. Please connect your account again.',
  link_revoked: 'This bank account was disconnected. Connect it again to continue.',
  linking_unavailable: 'Connecting a bank account isn’t available yet.',
  dispute_already_open:
    'There’s already an open dispute for this account. You can find it under Disputes.',
  not_editable: 'This dispute has already been sent, so it can’t be changed.',
  deadline_not_passed:
    'The bureau still has time to respond. You can escalate once the deadline passes.',
  rate_limit_exceeded: 'Too many attempts. Please wait a minute and try again.',
  upstream_timeout: 'This is taking longer than usual. Please try again in a moment.',
  upstream_unavailable: 'We can’t reach this service right now. Please try again shortly.',
};

export function describeError(err: unknown, fallback: string): string {
  if (err instanceof ApiError)
    return FRIENDLY[err.code] ?? (err.status >= 500 ? fallback : err.message || fallback);
  return `${fallback} Check your connection and try again.`;
}

/** Only an explicit auth rejection ends a session; outages and rate limits don't. */
export const isSignedOutError = (err: unknown): boolean =>
  err instanceof ApiError && (err.status === 401 || err.status === 403);

let refreshing: Promise<number> | null = null;

/** Resolves to the refresh response's HTTP status, or 0 if it never reached the API. */
async function refreshSession(): Promise<number> {
  refreshing ??= fetch(`${API_BASE_URL}/auth/refresh`, { method: 'POST', credentials: 'include' })
    .then((r) => r.status)
    .catch(() => 0)
    .finally(() => {
      setTimeout(() => (refreshing = null), 0);
    });
  return refreshing;
}

async function request<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
    credentials: 'include',
  });

  if (response.status === 401 && !retried && !path.startsWith('/auth/')) {
    const refresh = await refreshSession();
    if (refresh >= 200 && refresh < 300) return request<T>(path, init, true);
    if (refresh === 429) throw new ApiError(429, 'rate_limit_exceeded', '');
    if (refresh === 0 || refresh >= 500) throw new ApiError(503, 'upstream_unavailable', '');
  }

  if (!response.ok) {
    let code = 'request_failed';
    let message = '';
    try {
      const body = (await response.json()) as { error?: string; message?: string };
      code = body.error ?? code;
      message = body.message ?? '';
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(response.status, code, message);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

// --- Session ----------------------------------------------------------------
export const getPolicy = () => request<{ popiaPolicyVersion: string }>('/auth/policy');
export const login = (email: string, password: string) =>
  post<{ user: Me }>('/auth/login', { email, password });
export const logout = () => post<void>('/auth/logout');
export const verifyEmail = (token: string) => post<{ user: Me }>('/auth/verify-email', { token });
export interface SignupInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  mobileNumber: string;
  saIdNumber: string;
  popiaConsent: true;
  popiaPolicyVersion: string;
  creditCheckConsent: boolean;
  marketingConsent: boolean;
}
export const signup = (input: SignupInput) => post<{ user: Me }>('/auth/signup', input);

// --- Account & privacy ------------------------------------------------------
export const getMe = () => request<Me>('/me');
export const updateConsents = (
  changes: Partial<
    Record<'creditCheck' | 'openBanking' | 'marketing' | 'thirdPartySharing', boolean>
  >,
) => request<Me>('/me/consents', { method: 'PATCH', body: JSON.stringify(changes) });
export const exportMyData = () => request<Record<string, unknown>>('/me/export');
export const requestDeletion = () => post<{ scheduledFor: string }>('/me/deletion-request');
export const cancelDeletion = () => request<void>('/me/deletion-request', { method: 'DELETE' });

// --- Credit profile ---------------------------------------------------------
export const getCreditProfile = () => request<CreditProfileSummary>('/credit-profile');
export const getBureauAccounts = () => request<BureauAccountSummary[]>('/credit-profile/accounts');
export const refreshCreditProfile = () => post<RefreshResponse>('/credit-profile/refresh');
export const scoreBankReadiness = () =>
  post<{ score: number; tier: string; top_reasons: string[] }>('/bank-readiness/score');

// --- Disputes ---------------------------------------------------------------
export const listDisputes = () => request<{ disputes: Dispute[] }>('/disputes');
export const getDispute = (id: string) => request<Dispute>(`/disputes/${encodeURIComponent(id)}`);
export const createDispute = (input: {
  bureauAccountId: string;
  reason: DisputeReason;
  description: string;
  evidenceKeys?: string[];
}) => post<Dispute>('/disputes', input);
export const regenerateLetter = (id: string, description: string) =>
  post<Dispute>(`/disputes/${encodeURIComponent(id)}/regenerate-letter`, { description });
export const submitDispute = (id: string) =>
  post<Dispute>(`/disputes/${encodeURIComponent(id)}/submit`);
export const deleteDispute = (id: string) =>
  request<void>(`/disputes/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const escalateDispute = (id: string, caseNumber: string) =>
  post<Dispute>(`/disputes/${encodeURIComponent(id)}/escalate`, { caseNumber });

// --- Open banking -----------------------------------------------------------
export interface BankLink {
  id: string;
  source: 'stitch' | 'ozow';
  createdAt: string;
  revokedAt: string | null;
}
export interface IngestResult {
  snapshotId: string;
  periodMonths: number;
  monthlyNetIncome: number;
  monthlyAffordabilitySurplus: number | null;
  debtToIncomeRatio: number | null;
  transactionsStored: number;
}
export const listBankLinks = () => request<{ links: BankLink[] }>('/open-banking/links');
export const startBankLink = () =>
  post<{ authorizationUrl: string }>('/open-banking/links/stitch/start');
export const completeBankLink = (code: string, state: string) =>
  post<BankLink>('/open-banking/links/stitch/complete', { code, state });
export const disconnectBankLink = (id: string) =>
  request<void>(`/open-banking/links/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const ingestBankData = (linkId: string, periodStart: string, periodEnd: string) =>
  post<IngestResult>('/open-banking/snapshots/ingest', { linkId, periodStart, periodEnd });
