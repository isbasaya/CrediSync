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
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Plain-language messages for codes the user can act on. */
const FRIENDLY: Record<string, string> = {
  invalid_credentials: 'That email and password don’t match, or the account is temporarily locked. Try again in 15 minutes.',
  account_exists: 'An account already exists for these details. Try signing in instead.',
  invalid_sa_id: 'That South African ID number isn’t valid. Check the 13 digits and try again.',
  email_not_verified: 'Confirm your email address first — we sent you a link when you signed up.',
  credit_check_consent_required: 'Give CrediSync permission to request your credit reports first (Privacy settings).',
  refresh_too_soon: 'Your reports were refreshed recently. You can refresh again in about an hour.',
  open_banking_consent_required: 'Give permission to read your bank transactions first (Privacy settings).',
  dispute_already_open: 'There’s already an open dispute for this account.',
  deadline_not_passed: 'The bureau still has time to respond. You can escalate once the deadline passes.',
  rate_limit_exceeded: 'Too many attempts. Please wait a minute and try again.',
  upstream_timeout: 'This is taking longer than usual. Please try again in a moment.',
  upstream_unavailable: 'We can’t reach this service right now. Please try again shortly.',
};

export function describeError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return FRIENDLY[err.code] ?? (err.status >= 500 ? fallback : err.message || fallback);
  return `${fallback} Check your connection and try again.`;
}

let refreshing: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  refreshing ??= fetch(`${API_BASE_URL}/auth/refresh`, { method: 'POST', credentials: 'include' })
    .then((r) => r.ok)
    .catch(() => false)
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
    if (await refreshSession()) return request<T>(path, init, true);
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

const post = <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

// --- Session ----------------------------------------------------------------
export const getPolicy = () => request<{ popiaPolicyVersion: string }>('/auth/policy');
export const login = (email: string, password: string) => post<{ user: Me }>('/auth/login', { email, password });
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
export const updateConsents = (changes: Partial<Record<'creditCheck' | 'openBanking' | 'marketing' | 'thirdPartySharing', boolean>>) =>
  request<Me>('/me/consents', { method: 'PATCH', body: JSON.stringify(changes) });
export const exportMyData = () => request<Record<string, unknown>>('/me/export');
export const requestDeletion = () => post<{ scheduledFor: string }>('/me/deletion-request');
export const cancelDeletion = () => request<void>('/me/deletion-request', { method: 'DELETE' });

// --- Credit profile ---------------------------------------------------------
export const getCreditProfile = () => request<CreditProfileSummary>('/credit-profile');
export const getBureauAccounts = () => request<BureauAccountSummary[]>('/credit-profile/accounts');
export const refreshCreditProfile = () => post<RefreshResponse>('/credit-profile/refresh');
export const scoreBankReadiness = () => post<{ score: number; tier: string; top_reasons: string[] }>('/bank-readiness/score');

// --- Disputes ---------------------------------------------------------------
export const listDisputes = () => request<{ disputes: Dispute[] }>('/disputes');
export const getDispute = (id: string) => request<Dispute>(`/disputes/${encodeURIComponent(id)}`);
export const createDispute = (input: { bureauAccountId: string; reason: DisputeReason; description: string; evidenceKeys?: string[] }) =>
  post<Dispute>('/disputes', input);
export const regenerateLetter = (id: string, description: string) => post<Dispute>(`/disputes/${encodeURIComponent(id)}/regenerate-letter`, { description });
export const submitDispute = (id: string) => post<Dispute>(`/disputes/${encodeURIComponent(id)}/submit`);
