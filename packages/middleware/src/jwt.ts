import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { requireSecret } from '@credisync/config';

/**
 * Short-lived access tokens (15 min), HS256 only, with issuer and audience
 * pinned so a token minted for another purpose or by another system is
 * rejected. Long-lived sessions use rotating refresh tokens held by the
 * auth service (see services/auth).
 */

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const ACCESS_TOKEN_COOKIE = 'cs_at';
const ISSUER = 'credisync-auth';
const AUDIENCE = 'credisync-api';
const DEV_JWT_SECRET = 'credisync-dev-jwt-secret-not-for-production-use';

export type Role = 'consumer' | 'admin' | 'compliance_officer';

export interface AccessTokenClaims {
  sub: string;
  email: string;
  role: Role;
  verified: boolean;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: Role;
  verified: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      authVia?: 'bearer' | 'cookie';
    }
  }
}

export function jwtSecret(env: NodeJS.ProcessEnv = process.env): string {
  return requireSecret('JWT_SECRET', { devFallback: DEV_JWT_SECRET }, env);
}

const secret = () => jwtSecret();

export function signAccessToken(claims: AccessTokenClaims): string {
  return jwt.sign({ email: claims.email, role: claims.role, verified: claims.verified }, secret(), {
    algorithm: 'HS256',
    subject: claims.sub,
    issuer: ISSUER,
    audience: AUDIENCE,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  });
}

export class InvalidTokenError extends Error {
  constructor() {
    super('Invalid or expired token');
    this.name = 'InvalidTokenError';
  }
}

const ROLES: ReadonlySet<string> = new Set(['consumer', 'admin', 'compliance_officer']);

export function verifyAccessToken(token: string): AuthenticatedUser {
  try {
    const decoded = jwt.verify(token, secret(), {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
    }) as jwt.JwtPayload;
    if (
      typeof decoded.sub !== 'string' ||
      typeof decoded.email !== 'string' ||
      !ROLES.has(decoded.role)
    ) {
      throw new InvalidTokenError();
    }
    return {
      id: decoded.sub,
      email: decoded.email,
      role: decoded.role as Role,
      verified: decoded.verified === true,
    };
  } catch {
    throw new InvalidTokenError();
  }
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

/**
 * Accepts a Bearer token (mobile) or the httpOnly access cookie (web/admin).
 * Cookies are SameSite=Strict; state-changing cookie requests must also
 * pass the gateway's Origin check (see services/api-gateway).
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  let token: string | undefined;
  if (header?.startsWith('Bearer ')) {
    token = header.slice(7);
    req.authVia = 'bearer';
  } else {
    token = readCookie(req, ACCESS_TOKEN_COOKIE);
    req.authVia = token ? 'cookie' : undefined;
  }

  if (!token) {
    res.status(401).json({ error: 'missing_token', message: 'Authentication required' });
    return;
  }

  try {
    req.user = verifyAccessToken(token);
    next();
  } catch {
    res.status(401).json({ error: 'invalid_token', message: 'Invalid or expired token' });
  }
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'missing_token' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    next();
  };
}

export { readCookie };
