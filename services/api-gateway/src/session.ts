import type { CookieOptions, NextFunction, Request, Response } from 'express';
import { ACCESS_TOKEN_COOKIE, ACCESS_TOKEN_TTL_SECONDS, readCookie } from '@credisync/middleware';
import { isLocalEnv } from '@credisync/config';

/**
 * Browsers (web, admin) keep tokens in httpOnly cookies so page scripts —
 * and any XSS — can never read them. Native apps (mobile) opt in to
 * receiving tokens in the response body with `X-Client: mobile` and send
 * them back as a Bearer header / request body.
 */
export const REFRESH_TOKEN_COOKIE = 'cs_rt';
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;

function baseCookie(): CookieOptions {
  return {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : !isLocalEnv(),
    sameSite: 'strict',
  };
}

export function isNativeClient(req: Request): boolean {
  return req.headers['x-client'] === 'mobile';
}

interface TokenBody {
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  [key: string]: unknown;
}

/** Sets session cookies and decides whether tokens stay in the body. */
export function deliverSession(req: Request, res: Response, status: number, body: TokenBody): void {
  if (body.accessToken) {
    res.cookie(ACCESS_TOKEN_COOKIE, body.accessToken, {
      ...baseCookie(),
      path: '/api',
      maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000,
    });
  }
  if (body.refreshToken) {
    res.cookie(REFRESH_TOKEN_COOKIE, body.refreshToken, {
      ...baseCookie(),
      path: '/api/auth',
      maxAge: REFRESH_TTL_SECONDS * 1000,
    });
  }
  if (isNativeClient(req)) {
    res.status(status).json(body);
    return;
  }

  const { accessToken: _a, refreshToken: _r, ...rest } = body;
  res.status(status).json(rest);
}

export function clearSession(res: Response): void {
  res.clearCookie(ACCESS_TOKEN_COOKIE, { ...baseCookie(), path: '/api' });
  res.clearCookie(REFRESH_TOKEN_COOKIE, { ...baseCookie(), path: '/api/auth' });
}

export function refreshTokenFrom(req: Request): string | undefined {
  const fromBody = (req.body as { refreshToken?: unknown } | undefined)?.refreshToken;
  if (typeof fromBody === 'string') return fromBody;
  return readCookie(req, REFRESH_TOKEN_COOKIE);
}

/**
 * CSRF defence for cookie sessions: SameSite=Strict cookies already stay
 * off cross-site requests; additionally every state-changing request that
 * carries cookies must come from an allowed Origin.
 */
export function originCheck(allowedOrigins: ReadonlySet<string>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const safe = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';
    const usesCookies = Boolean(req.headers.cookie) && !req.headers.authorization;
    if (safe || !usesCookies) return next();

    const origin = req.headers.origin;
    if (typeof origin === 'string' && allowedOrigins.has(origin)) return next();
    res.status(403).json({ error: 'origin_not_allowed' });
  };
}
