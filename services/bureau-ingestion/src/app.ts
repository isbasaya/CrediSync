import express, { type NextFunction, type Request, type Response } from 'express';
import pino from 'pino';
import type { Pool } from 'pg';
import {
  asyncHandler,
  configureTrustProxy,
  requireActingUser,
  requireInternalToken,
  securityHeaders,
  standardRateLimiter,
  traceIdMiddleware,
} from '@credisync/middleware';
import { createAdapters, refreshCreditProfile, RefreshRefusedError } from './orchestrator';
import { getCurrentAccounts, getCurrentProfile } from './db';
import type { BureauAdapter } from './adapters/bureau-adapter.interface';

const logger = pino({ name: 'bureau-ingestion' });

/**
 * Internal service. Every route requires the gateway's service token and
 * acts only for the user named in X-Acting-User-Id — there is no route that
 * takes a user id from the URL or body.
 */
export function createApp(pool: Pool, adapters: BureauAdapter[] = createAdapters()) {
  const app = express();
  configureTrustProxy(app);
  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use(traceIdMiddleware);

  app.get('/healthz', (_req, res) => res.status(200).json({ status: 'ok' }));

  app.use(requireInternalToken, requireActingUser, standardRateLimiter, express.json({ limit: '16kb' }));

  app.get(
    '/credit-profile',
    asyncHandler(async (req, res) => {
      const profile = await getCurrentProfile(pool, req.actingUserId!);
      if (!profile) return res.status(404).json({ error: 'no_credit_profile', message: 'No credit profile yet. Refresh to fetch your reports.' });
      return res.json(profile);
    })
  );

  app.get(
    '/credit-profile/accounts',
    asyncHandler(async (req, res) => res.json(await getCurrentAccounts(pool, req.actingUserId!)))
  );

  app.post(
    '/credit-profile/refresh',
    asyncHandler(async (req, res) => {
      const result = await refreshCreditProfile(pool, req.actingUserId!, adapters);
      const profile = await getCurrentProfile(pool, req.actingUserId!);
      // 207 Multi-Status: refreshed, but at least one bureau failed.
      return res.status(result.bureauFailures.length > 0 ? 207 : 200).json({ profile, bureauFailures: result.bureauFailures });
    })
  );

   
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof RefreshRefusedError) {
      if (err.retryAfterSeconds) res.setHeader('Retry-After', String(err.retryAfterSeconds));
      return res.status(err.status).json({ error: err.code, message: err.message });
    }
    logger.error({ err, traceId: req.traceId }, 'unhandled error in bureau-ingestion service');
    return res.status(500).json({ error: 'internal_error', traceId: req.traceId });
  });

  return app;
}
