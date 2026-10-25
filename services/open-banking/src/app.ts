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
import { INGESTION_SOURCES } from '@credisync/types';
import { StitchAdapter } from './adapters/stitch.adapter';
import { OzowAdapter } from './adapters/ozow.adapter';
import { SandboxOpenBankingAdapter } from './adapters/sandbox.adapter';
import {
  OpenBankingFetchError,
  type OpenBankingAdapter,
} from './adapters/open-banking-adapter.interface';
import { buildFinancialHealthSnapshot } from './aggregation/snapshot-builder';
import { loadExpenseNorms } from './aggregation/expense-norms';
import * as db from './db';
import type { IngestionSource } from './types';

const logger = pino({ name: 'open-banking' });

const MAX_PERIOD_DAYS = 186;

export function createAdapters(
  env: NodeJS.ProcessEnv = process.env,
): Record<IngestionSource, OpenBankingAdapter> {
  if (env.OPEN_BANKING_MODE === 'sandbox') {
    return {
      stitch: new SandboxOpenBankingAdapter('stitch'),
      ozow: new SandboxOpenBankingAdapter('ozow'),
    };
  }
  return { stitch: new StitchAdapter(), ozow: new OzowAdapter() };
}

const linkSchema = z.object({
  source: z.enum(INGESTION_SOURCES),
  accountLinkToken: z.string().min(8).max(4096),
});
const ingestSchema = z
  .object({
    linkId: z.string().uuid(),
    periodStart: z.string().date(),
    periodEnd: z.string().date(),
  })
  .refine((v) => v.periodEnd >= v.periodStart, 'periodEnd must be on or after periodStart')
  .refine(
    (v) => (Date.parse(v.periodEnd) - Date.parse(v.periodStart)) / 86_400_000 <= MAX_PERIOD_DAYS,
    `period must be at most ${MAX_PERIOD_DAYS} days`,
  )
  .refine(
    (v) => v.periodEnd <= new Date().toISOString().slice(0, 10),
    'periodEnd cannot be in the future',
  );

function invalid(res: Response, err: z.ZodError) {
  return res.status(400).json({ error: 'invalid_request', details: err.flatten() });
}

export function createApp(
  pool: Pool,
  adapters: Record<IngestionSource, OpenBankingAdapter> = createAdapters(),
) {
  const app = express();
  configureTrustProxy(app);
  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use(traceIdMiddleware);

  app.get('/healthz', (_req, res) => res.status(200).json({ status: 'ok' }));

  app.use(
    requireInternalToken,
    requireActingUser,
    standardRateLimiter,
    express.json({ limit: '16kb' }),
  );

  app.post(
    '/links',
    asyncHandler(async (req, res) => {
      const parsed = linkSchema.safeParse(req.body);
      if (!parsed.success) return invalid(res, parsed.error);
      return res
        .status(201)
        .json(
          await db.createLink(
            pool,
            req.actingUserId!,
            parsed.data.source,
            parsed.data.accountLinkToken,
          ),
        );
    }),
  );

  app.get(
    '/links',
    asyncHandler(async (req, res) =>
      res.json({ links: await db.listLinks(pool, req.actingUserId!) }),
    ),
  );

  app.delete(
    '/links/:id',
    asyncHandler(async (req, res) => {
      const id = z.string().uuid().safeParse(req.params.id);
      if (!id.success) return res.status(404).json({ error: 'not_found' });
      await db.revokeLink(pool, req.actingUserId!, id.data);
      return res.status(204).send();
    }),
  );

  app.post(
    '/snapshots/ingest',
    asyncHandler(async (req, res) => {
      const parsed = ingestSchema.safeParse(req.body);
      if (!parsed.success) return invalid(res, parsed.error);
      const userId = req.actingUserId!;
      const { linkId, periodStart, periodEnd } = parsed.data;

      const link = await db.loadLinkToken(pool, userId, linkId);
      const feed = await adapters[link.source].fetchTransactions({
        userId,
        accountLinkToken: link.token,
        periodStart,
        periodEnd,
      });
      const snapshot = buildFinancialHealthSnapshot(userId, feed, loadExpenseNorms());
      const { snapshotId, inserted } = await db.persistSnapshot(pool, snapshot);

      return res.status(201).json({
        snapshotId,
        periodMonths: snapshot.periodMonths,
        monthlyNetIncome: snapshot.netIncome,
        monthlyAffordabilitySurplus: snapshot.affordabilitySurplus,
        debtToIncomeRatio: snapshot.debtToIncomeRatio,
        transactionsStored: inserted,
      });
    }),
  );

  app.get(
    '/snapshots/latest',
    asyncHandler(async (req, res) => {
      const snap = await db.latestSnapshot(pool, req.actingUserId!);
      if (!snap) return res.status(404).json({ error: 'no_snapshot' });
      return res.json(snap);
    }),
  );

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof db.OpenBankingError)
      return res.status(err.status).json({ error: err.code, message: err.message });
    if (err instanceof OpenBankingFetchError) {
      const status = err.cause === 'consent_revoked' ? 409 : 502;
      return res.status(status).json({
        error: `provider_${err.cause}`,
        message: 'Your bank connection could not be read. Try again or relink.',
      });
    }
    logger.error({ err, traceId: req.traceId }, 'unhandled error in open-banking service');
    return res.status(500).json({ error: 'internal_error', traceId: req.traceId });
  });

  return app;
}
