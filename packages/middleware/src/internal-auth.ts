import type { NextFunction, Request, Response } from 'express';
import { requireSecret } from '@credisync/config';
import { safeEqual } from '@credisync/crypto';

/**
 * Service-to-service authentication.
 *
 * Internal services (bureau-ingestion, dispute-engine, open-banking) are
 * only reachable through the API gateway. The gateway sends:
 *   X-Internal-Token    shared secret (INTERNAL_SERVICE_TOKEN)
 *   X-Acting-User-Id    the authenticated consumer, if any
 *   X-Acting-User-Role  that user's role
 *
 * Internal services take the acting user ONLY from these headers, never from
 * the request body, so a client cannot act for someone else even if it
 * reaches a service directly. In production also restrict these services to
 * the private network (security groups); the token is defence in depth.
 */

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      actingUserId?: string;
      actingUserRole?: string;
    }
  }
}

export const INTERNAL_TOKEN_HEADER = 'x-internal-token';
export const ACTING_USER_HEADER = 'x-acting-user-id';
export const ACTING_ROLE_HEADER = 'x-acting-user-role';

const DEV_INTERNAL_TOKEN = 'credisync-dev-internal-token-not-for-production';

export function internalServiceToken(env: NodeJS.ProcessEnv = process.env): string {
  return requireSecret('INTERNAL_SERVICE_TOKEN', { devFallback: DEV_INTERNAL_TOKEN }, env);
}

export function requireInternalToken(req: Request, res: Response, next: NextFunction): void {
  const presented = req.headers[INTERNAL_TOKEN_HEADER];
  if (typeof presented !== 'string' || !safeEqual(presented, internalServiceToken())) {
    res.status(401).json({ error: 'unauthorized_service' });
    return;
  }
  const userId = req.headers[ACTING_USER_HEADER];
  const role = req.headers[ACTING_ROLE_HEADER];
  req.actingUserId = typeof userId === 'string' && userId.length > 0 ? userId : undefined;
  req.actingUserRole = typeof role === 'string' && role.length > 0 ? role : undefined;
  next();
}

/** Rejects requests that don't carry an acting consumer (for per-user endpoints). */
export function requireActingUser(req: Request, res: Response, next: NextFunction): void {
  if (!req.actingUserId) {
    res.status(401).json({ error: 'missing_acting_user' });
    return;
  }
  next();
}

export function internalHeaders(
  user?: { id: string; role: string },
  traceId?: string,
): Record<string, string> {
  return {
    [INTERNAL_TOKEN_HEADER]: internalServiceToken(),
    ...(user ? { [ACTING_USER_HEADER]: user.id, [ACTING_ROLE_HEADER]: user.role } : {}),
    ...(traceId ? { 'x-trace-id': traceId } : {}),
  };
}
