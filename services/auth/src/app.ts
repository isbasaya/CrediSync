import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import pino from 'pino';
import type { Pool } from 'pg';
import {
  asyncHandler,
  configureTrustProxy,
  requireActingUser,
  requireInternalToken,
  securityHeaders,
  standardRateLimiter,
  strictRateLimiter,
  traceIdMiddleware,
} from '@credisync/middleware';
import * as service from './service';

const logger = pino({ name: 'auth-service', redact: ['req.headers.authorization', 'password', 'saIdNumber'] });

const signupSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(10).max(128),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  mobileNumber: z.string().regex(/^\+27[0-9]{9}$/, 'must be a valid SA mobile number (+27...)'),
  saIdNumber: z.string().regex(/^[0-9 ]{13,16}$/, 'must be a 13-digit SA ID number'),
  popiaConsent: z.literal(true, { errorMap: () => ({ message: 'POPIA consent is required to create an account' }) }),
  popiaPolicyVersion: z.string().min(1),
  creditCheckConsent: z.boolean(),
  marketingConsent: z.boolean().optional(),
});

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1).max(128) });
const tokenSchema = z.object({ refreshToken: z.string().min(20).max(200) });
const verifySchema = z.object({ token: z.string().min(20).max(200) });
const consentSchema = z
  .object({
    creditCheck: z.boolean().optional(),
    openBanking: z.boolean().optional(),
    marketing: z.boolean().optional(),
    thirdPartySharing: z.boolean().optional(),
  })
  .strict();

function meta(req: Request): service.RequestMeta {
  // The gateway forwards the end-user's address and agent.
  const forwardedIp = req.headers['x-client-ip'];
  return {
    ip: typeof forwardedIp === 'string' ? forwardedIp : (req.ip ?? null),
    userAgent: (req.headers['x-client-user-agent'] as string | undefined) ?? req.headers['user-agent'] ?? null,
  };
}

function badRequest(res: Response, error: z.ZodError) {
  return res.status(400).json({ error: 'invalid_request', details: error.flatten() });
}

export function createApp(pool: Pool) {
  const app = express();
  configureTrustProxy(app);
  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use(traceIdMiddleware);

  app.get('/healthz', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.status(200).json({ status: 'ok', database: 'connected' });
    } catch {
      res.status(503).json({ status: 'degraded', database: 'disconnected' });
    }
  });

  app.use(requireInternalToken);
  app.use(standardRateLimiter);
  app.use(express.json({ limit: '32kb' }));

  app.get('/auth/policy', (_req, res) => {
    res.json({ popiaPolicyVersion: service.CURRENT_POPIA_POLICY_VERSION });
  });

  app.post(
    '/auth/signup',
    strictRateLimiter,
    asyncHandler(async (req, res) => {
      const parsed = signupSchema.safeParse(req.body);
      if (!parsed.success) return badRequest(res, parsed.error);
      const result = await service.signup(pool, parsed.data, meta(req));
      return res.status(201).json(result);
    })
  );

  app.post(
    '/auth/login',
    strictRateLimiter,
    asyncHandler(async (req, res) => {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) return badRequest(res, parsed.error);
      const result = await service.login(pool, parsed.data.email, parsed.data.password, meta(req));
      return res.status(200).json(result);
    })
  );

  app.post(
    '/auth/refresh',
    strictRateLimiter,
    asyncHandler(async (req, res) => {
      const parsed = tokenSchema.safeParse(req.body);
      if (!parsed.success) return badRequest(res, parsed.error);
      return res.status(200).json(await service.refresh(pool, parsed.data.refreshToken, meta(req)));
    })
  );

  app.post(
    '/auth/logout',
    asyncHandler(async (req, res) => {
      const parsed = tokenSchema.safeParse(req.body);
      if (parsed.success) await service.logout(pool, parsed.data.refreshToken, meta(req));
      return res.status(204).send();
    })
  );

  app.post(
    '/auth/verify-email',
    strictRateLimiter,
    asyncHandler(async (req, res) => {
      const parsed = verifySchema.safeParse(req.body);
      if (!parsed.success) return badRequest(res, parsed.error);
      const result = await service.verifyEmail(pool, parsed.data.token);
      if (!result) return res.status(400).json({ error: 'invalid_or_expired_token' });
      return res.status(200).json(result);
    })
  );

  app.get(
    '/auth/me',
    requireActingUser,
    asyncHandler(async (req, res) => {
      const profile = await service.getProfile(pool, req.actingUserId!);
      if (!profile) return res.status(404).json({ error: 'not_found' });
      return res.json(profile);
    })
  );

  app.patch(
    '/auth/me/consents',
    requireActingUser,
    asyncHandler(async (req, res) => {
      const parsed = consentSchema.safeParse(req.body);
      if (!parsed.success) return badRequest(res, parsed.error);
      await service.updateConsents(pool, req.actingUserId!, parsed.data, meta(req));
      return res.json(await service.getProfile(pool, req.actingUserId!));
    })
  );

  app.get(
    '/auth/me/export',
    requireActingUser,
    asyncHandler(async (req, res) => {
      res.setHeader('Content-Disposition', 'attachment; filename="credisync-personal-data.json"');
      return res.json(await service.exportPersonalData(pool, req.actingUserId!, meta(req)));
    })
  );

  app.post(
    '/auth/me/deletion-request',
    requireActingUser,
    asyncHandler(async (req, res) => {
      return res.status(202).json(await service.requestDeletion(pool, req.actingUserId!, meta(req)));
    })
  );

  app.delete(
    '/auth/me/deletion-request',
    requireActingUser,
    asyncHandler(async (req, res) => {
      await service.cancelDeletion(pool, req.actingUserId!);
      return res.status(204).send();
    })
  );

   
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof service.AuthError) {
      return res.status(err.statusCode).json({ error: err.code, message: err.message });
    }
    logger.error({ err, traceId: req.traceId }, 'unhandled error in auth service');
    return res.status(500).json({ error: 'internal_error', traceId: req.traceId });
  });

  return app;
}
