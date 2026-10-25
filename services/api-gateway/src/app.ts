import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import pino from 'pino';
import type { Pool } from 'pg';
import {
  asyncHandler,
  configureTrustProxy,
  createRateLimiter,
  requireAuth,
  securityHeaders,
  standardRateLimiter,
  traceIdMiddleware,
} from '@credisync/middleware';
import { callService, forward, UpstreamError } from './proxy';
import { clearSession, deliverSession, originCheck, refreshTokenFrom } from './session';
import { createAdminRouter } from './admin-router';
import { ReadinessError, scoreBankReadiness } from './bank-readiness';

const logger = pino({ name: 'api-gateway' });

export interface GatewayConfig {
  authUrl: string;
  bureauIngestionUrl: string;
  disputeEngineUrl: string;
  openBankingUrl: string;
  bankReadinessUrl: string;
  allowedOrigins: string[];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  return {
    authUrl: env.AUTH_SERVICE_URL ?? 'http://localhost:4004',
    bureauIngestionUrl: env.BUREAU_INGESTION_URL ?? 'http://localhost:4001',
    disputeEngineUrl: env.DISPUTE_ENGINE_URL ?? 'http://localhost:4002',
    openBankingUrl: env.OPEN_BANKING_URL ?? 'http://localhost:4003',
    bankReadinessUrl: env.BANK_READINESS_URL ?? 'http://localhost:8000',
    allowedOrigins: (env.ALLOWED_ORIGINS ?? env.WEB_ORIGIN ?? 'http://localhost:3000,http://localhost:3001')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  };
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Path ids are validated before being placed into upstream URLs. */
function id(req: Request): string {
  const value = req.params.id ?? '';
  return uuidPattern.test(value) ? value : '00000000-0000-4000-8000-000000000000';
}

/** Per-user limit for expensive operations (bureau pulls, ingests, scoring). */
const perUserLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  maxRequests: 20,
  perRoute: true,
  keyGenerator: (req) => req.user?.id ?? req.ip ?? 'anon',
});

export function createApp(pool: Pool, config: GatewayConfig = loadConfig()) {
  const app = express();
  configureTrustProxy(app);
  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use(traceIdMiddleware);

  const origins = new Set(config.allowedOrigins);
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || origins.has(origin)),
      credentials: true,
      allowedHeaders: ['content-type', 'authorization', 'x-client', 'x-trace-id'],
      exposedHeaders: ['x-trace-id', 'retry-after'],
    })
  );

  // Liveness for the load balancer: the gateway itself only. Downstream
  // health is an admin-only view (GET /api/admin/dashboard), so internal
  // topology isn't public and one slow service can't take the gateway out.
  app.get('/api/healthz', (_req, res) => res.status(200).json({ status: 'ok' }));

  // Bureau webhooks: signed by the bureau and verified by the dispute engine
  // over the exact raw bytes, so forward the body untouched.
  app.post(
    '/api/webhooks/bureau-response',
    express.raw({ type: 'application/json', limit: '64kb' }),
    asyncHandler(async (req, res) => {
      let upstream: globalThis.Response;
      try {
        upstream = await fetch(`${config.disputeEngineUrl}/webhooks/bureau-response`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-credisync-signature': String(req.headers['x-credisync-signature'] ?? ''),
            ...(req.traceId ? { 'x-trace-id': req.traceId } : {}),
          },
          body: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        throw new UpstreamError(502, 'upstream_unavailable');
      }
      res.status(upstream.status).type('application/json').send(await upstream.text());
    })
  );

  app.use(standardRateLimiter);
  app.use(express.json({ limit: '64kb' }));
  app.use(originCheck(origins));

  // ---- Authentication (public) -------------------------------------------
  const authForward = (path: string) =>
    asyncHandler(async (req, res) => {
      const r = await callService(config.authUrl, path, req, { actingUser: null });
      if (r.status >= 200 && r.status < 300 && r.data && typeof r.data === 'object') {
        deliverSession(req, res, r.status, r.data as Record<string, unknown>);
        return;
      }
      res.status(r.status).json(r.data);
    });

  app.get('/api/auth/policy', asyncHandler((req, res) => forward(config.authUrl, '/auth/policy', req, res, { actingUser: null })));
  app.post('/api/auth/signup', authForward('/auth/signup'));
  app.post('/api/auth/login', authForward('/auth/login'));
  app.post('/api/auth/verify-email', authForward('/auth/verify-email'));
  app.post(
    '/api/auth/refresh',
    asyncHandler(async (req, res) => {
      const refreshToken = refreshTokenFrom(req);
      if (!refreshToken) {
        clearSession(res);
        return res.status(401).json({ error: 'missing_refresh_token' });
      }
      const r = await callService(config.authUrl, '/auth/refresh', req, { actingUser: null, method: 'POST', body: { refreshToken } });
      if (r.status === 200) return deliverSession(req, res, 200, r.data as Record<string, unknown>);
      clearSession(res);
      return res.status(r.status).json(r.data);
    })
  );
  app.post(
    '/api/auth/logout',
    asyncHandler(async (req, res) => {
      const refreshToken = refreshTokenFrom(req);
      if (refreshToken) await callService(config.authUrl, '/auth/logout', req, { actingUser: null, method: 'POST', body: { refreshToken } });
      clearSession(res);
      res.status(204).end();
    })
  );

  // ---- Everything below requires a signed-in user ------------------------
  app.use('/api/admin', createAdminRouter(pool, config));
  app.use('/api', requireAuth);

  // Account, consent and POPIA rights
  app.get('/api/me', asyncHandler((req, res) => forward(config.authUrl, '/auth/me', req, res)));
  app.patch('/api/me/consents', asyncHandler((req, res) => forward(config.authUrl, '/auth/me/consents', req, res)));
  app.get('/api/me/export', asyncHandler((req, res) => forward(config.authUrl, '/auth/me/export', req, res)));
  app.post('/api/me/deletion-request', asyncHandler((req, res) => forward(config.authUrl, '/auth/me/deletion-request', req, res)));
  app.delete('/api/me/deletion-request', asyncHandler((req, res) => forward(config.authUrl, '/auth/me/deletion-request', req, res)));

  // Credit profile (always the signed-in user's own)
  app.get('/api/credit-profile', asyncHandler((req, res) => forward(config.bureauIngestionUrl, '/credit-profile', req, res)));
  app.get('/api/credit-profile/accounts', asyncHandler((req, res) => forward(config.bureauIngestionUrl, '/credit-profile/accounts', req, res)));
  app.post(
    '/api/credit-profile/refresh',
    perUserLimiter,
    asyncHandler((req, res) => forward(config.bureauIngestionUrl, '/credit-profile/refresh', req, res, { timeoutMs: 45_000 }))
  );

  // Disputes
  app.get('/api/disputes', asyncHandler((req, res) => forward(config.disputeEngineUrl, '/disputes', req, res)));
  app.post('/api/disputes', asyncHandler((req, res) => forward(config.disputeEngineUrl, '/disputes', req, res)));
  app.post(
    '/api/disputes/evidence-uploads',
    asyncHandler((req, res) => forward(config.disputeEngineUrl, '/disputes/evidence-uploads', req, res))
  );
  app.get('/api/disputes/:id', asyncHandler((req, res) => forward(config.disputeEngineUrl, `/disputes/${id(req)}`, req, res)));
  for (const action of ['regenerate-letter', 'submit', 'escalate']) {
    app.post(
      `/api/disputes/:id/${action}`,
      asyncHandler((req, res) => forward(config.disputeEngineUrl, `/disputes/${id(req)}/${action}`, req, res))
    );
  }

  // Open banking
  app.get('/api/open-banking/links', asyncHandler((req, res) => forward(config.openBankingUrl, '/links', req, res)));
  app.post('/api/open-banking/links', asyncHandler((req, res) => forward(config.openBankingUrl, '/links', req, res)));
  app.delete('/api/open-banking/links/:id', asyncHandler((req, res) => forward(config.openBankingUrl, `/links/${id(req)}`, req, res)));
  app.post(
    '/api/open-banking/snapshots/ingest',
    perUserLimiter,
    asyncHandler((req, res) => forward(config.openBankingUrl, '/snapshots/ingest', req, res, { timeoutMs: 30_000 }))
  );
  app.get('/api/open-banking/snapshots/latest', asyncHandler((req, res) => forward(config.openBankingUrl, '/snapshots/latest', req, res)));

  // Bank readiness: computed from server-side data only
  app.post(
    '/api/bank-readiness/score',
    perUserLimiter,
    asyncHandler(async (req, res) => {
      res.json(await scoreBankReadiness(pool, config.bankReadinessUrl, req.user!.id, req.traceId));
    })
  );

  app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found' }));

   
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof UpstreamError) return res.status(err.status).json({ error: err.message, traceId: req.traceId });
    if (err instanceof ReadinessError) return res.status(err.status).json({ error: err.code, message: err.message });
    if ((err as { type?: string }).type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid_json' });
    logger.error({ err, traceId: req.traceId }, 'unhandled error in api-gateway');
    return res.status(500).json({ error: 'internal_error', traceId: req.traceId });
  });

  return app;
}
