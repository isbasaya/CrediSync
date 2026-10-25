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
  traceIdMiddleware,
} from '@credisync/middleware';
import { createEvidenceUpload, EvidenceValidationError } from '@credisync/storage';
import { BUREAU_SOURCES, DISPUTE_REASONS } from './types';
import { InvalidTransitionError } from './state-machine';
import * as service from './service';
import { SIGNATURE_HEADER, verifyWebhookSignature, webhookSecret } from './webhook-signature';

const logger = pino({ name: 'dispute-engine' });

const uuid = z.string().uuid();
const createSchema = z.object({
  bureauAccountId: uuid,
  reason: z.enum(DISPUTE_REASONS),
  description: z
    .string()
    .trim()
    .min(20, 'Give the bureau enough detail to investigate (at least 20 characters)')
    .max(4000),
  evidenceKeys: z.array(z.string().max(200)).max(10).default([]),
});
const regenerateSchema = z.object({ description: z.string().trim().min(20).max(4000) });
const escalateSchema = z.object({ caseNumber: z.string().trim().min(1).max(64) });
const uploadSchema = z.object({
  contentType: z.string(),
  contentLength: z.number().int().positive(),
});
const adminResponseSchema = z.object({
  response: z.string().trim().min(1).max(8000),
  reference: z.string().trim().max(100).nullable().default(null),
  resolution: z.enum(['upheld', 'rejected']).nullable().default(null),
});
const referenceSchema = z.object({ bureauReference: z.string().trim().min(1).max(100) });
const webhookSchema = z.object({
  eventId: z.string().min(8).max(100),
  disputeId: uuid,
  bureau: z.enum(BUREAU_SOURCES),
  response: z.string().min(1).max(8000),
  reference: z.string().max(100).nullable().default(null),
  resolution: z.enum(['upheld', 'rejected']).nullable().default(null),
});

const OPS_ROLES = new Set(['admin', 'compliance_officer']);

function requireOpsRole(req: Request, res: Response, next: NextFunction): void {
  if (!req.actingUserRole || !OPS_ROLES.has(req.actingUserRole)) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  next();
}

function param(req: Request): string {
  const parsed = uuid.safeParse(req.params.id);
  if (!parsed.success) throw new service.DisputeError(404, 'not_found', 'Dispute not found');
  return parsed.data;
}

function invalid(res: Response, err: z.ZodError) {
  return res.status(400).json({ error: 'invalid_request', details: err.flatten() });
}

export function createApp(pool: Pool) {
  const app = express();
  configureTrustProxy(app);
  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use(traceIdMiddleware);

  app.get('/healthz', (_req, res) => res.status(200).json({ status: 'ok' }));

  /**
   * Bureau webhook: authenticated by HMAC signature over the raw body (not
   * by the gateway token), so it is registered before the JSON parser.
   */
  app.post(
    '/webhooks/bureau-response',
    express.raw({ type: 'application/json', limit: '64kb' }),
    asyncHandler(async (req, res) => {
      const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf-8') : '';
      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        return res.status(400).json({ error: 'invalid_json' });
      }
      const parsed = webhookSchema.safeParse(body);
      if (!parsed.success) return invalid(res, parsed.error);

      const signature = req.headers[SIGNATURE_HEADER];
      if (
        !verifyWebhookSignature(
          typeof signature === 'string' ? signature : undefined,
          raw,
          webhookSecret(parsed.data.bureau),
        )
      ) {
        return res.status(401).json({ error: 'invalid_signature' });
      }

      const result = await service.handleBureauWebhook(pool, parsed.data);
      return res.status(200).json({ received: true, duplicate: result.duplicate });
    }),
  );

  app.use(
    requireInternalToken,
    requireActingUser,
    standardRateLimiter,
    express.json({ limit: '32kb' }),
  );

  // --- Consumer routes: always scoped to the acting user -------------------

  app.get(
    '/disputes',
    asyncHandler(async (req, res) =>
      res.json({ disputes: await service.listDisputes(pool, req.actingUserId!) }),
    ),
  );

  app.post(
    '/disputes/evidence-uploads',
    asyncHandler(async (req, res) => {
      const parsed = uploadSchema.safeParse(req.body);
      if (!parsed.success) return invalid(res, parsed.error);
      return res
        .status(201)
        .json(
          await createEvidenceUpload(
            req.actingUserId!,
            parsed.data.contentType,
            parsed.data.contentLength,
          ),
        );
    }),
  );

  app.get(
    '/disputes/:id',
    asyncHandler(async (req, res) =>
      res.json(await service.getDispute(pool, req.actingUserId!, param(req))),
    ),
  );

  app.get(
    '/disputes/:id/letter.pdf',
    asyncHandler(async (req, res) => {
      const pdf = await service.consumerLetterPdf(pool, req.actingUserId!, param(req));
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="credisync-dispute-${param(req).slice(0, 8)}.pdf"`,
      );
      res.setHeader('Cache-Control', 'no-store');
      return res.send(pdf);
    }),
  );

  app.post(
    '/disputes',
    asyncHandler(async (req, res) => {
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) return invalid(res, parsed.error);
      return res
        .status(201)
        .json(await service.createDispute(pool, req.actingUserId!, parsed.data));
    }),
  );

  app.post(
    '/disputes/:id/regenerate-letter',
    asyncHandler(async (req, res) => {
      const parsed = regenerateSchema.safeParse(req.body);
      if (!parsed.success) return invalid(res, parsed.error);
      return res.json(
        await service.regenerateLetter(
          pool,
          req.actingUserId!,
          param(req),
          parsed.data.description,
        ),
      );
    }),
  );

  app.post(
    '/disputes/:id/submit',
    asyncHandler(async (req, res) =>
      res.json(await service.submitDispute(pool, req.actingUserId!, param(req))),
    ),
  );

  app.post(
    '/disputes/:id/escalate',
    asyncHandler(async (req, res) => {
      const parsed = escalateSchema.safeParse(req.body);
      if (!parsed.success) return invalid(res, parsed.error);
      return res.json(
        await service.escalateDispute(pool, req.actingUserId!, param(req), parsed.data.caseNumber),
      );
    }),
  );

  // --- Operations routes: admin / compliance officers only ----------------

  app.get(
    '/admin/disputes/:id/lodging-letter.pdf',
    requireOpsRole,
    asyncHandler(async (req, res) => {
      const pdf = await service.lodgingLetterPdf(pool, req.actingUserId!, param(req));
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="lodging-${param(req).slice(0, 8)}.pdf"`,
      );
      res.setHeader('Cache-Control', 'no-store');
      return res.send(pdf);
    }),
  );

  app.post(
    '/admin/disputes/:id/bureau-reference',
    requireOpsRole,
    asyncHandler(async (req, res) => {
      const parsed = referenceSchema.safeParse(req.body);
      if (!parsed.success) return invalid(res, parsed.error);
      return res.json(
        await service.recordBureauReference(
          pool,
          req.actingUserId!,
          param(req),
          parsed.data.bureauReference,
        ),
      );
    }),
  );

  app.post(
    '/admin/disputes/:id/bureau-response',
    requireOpsRole,
    asyncHandler(async (req, res) => {
      const parsed = adminResponseSchema.safeParse(req.body);
      if (!parsed.success) return invalid(res, parsed.error);
      return res.json(
        await service.adminRecordResponse(pool, req.actingUserId!, param(req), parsed.data),
      );
    }),
  );

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof service.DisputeError)
      return res.status(err.status).json({ error: err.code, message: err.message });
    if (err instanceof InvalidTransitionError)
      return res.status(409).json({ error: 'invalid_transition', message: err.message });
    if (err instanceof EvidenceValidationError)
      return res.status(400).json({ error: 'invalid_evidence', message: err.message });
    logger.error({ err, traceId: req.traceId }, 'unhandled error in dispute-engine service');
    return res.status(500).json({ error: 'internal_error', traceId: req.traceId });
  });

  return app;
}
