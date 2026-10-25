/**
 * Admin portal API client. The session lives in httpOnly cookies set by the
 * gateway — no token is ever readable by page scripts or stored in
 * localStorage. A 401 triggers one silent refresh, then a redirect to sign in.
 */
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api';

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

let refreshing: Promise<boolean> | null = null;

function refreshSession(): Promise<boolean> {
  refreshing ??= fetch(`${API_BASE_URL}/auth/refresh`, { method: 'POST', credentials: 'include' })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => setTimeout(() => (refreshing = null), 0));
  return refreshing;
}

async function request<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });

  if (response.status === 401 && !path.startsWith('/auth/')) {
    if (!retried && (await refreshSession())) return request<T>(path, init, true);
    if (typeof window !== 'undefined' && window.location.pathname !== '/login')
      window.location.href = '/login';
    throw new ApiError(401, 'unauthorized', 'Your session has ended. Sign in again.');
  }

  if (!response.ok) {
    let code = 'request_failed';
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string; message?: string };
      code = body.error ?? code;
      if (body.message) message = body.message;
    } catch {
      /* non-JSON body */
    }
    throw new ApiError(response.status, code, message);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
};
