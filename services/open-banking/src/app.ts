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
import {
  OAuthExchangeError,
  SandboxOAuthClient,
  StitchOAuthClient,
  loadStitchConfig,
  type LinkOAuthClient,
} from './providers/stitch-oauth';
import { isLocalEnv } from '@credisync/config';
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

/** Refresh a provider token this long before it expires. */
const TOKEN_REFRESH_SKEW_MS = 60_000;

export function createOAuthClient(env: NodeJS.ProcessEnv = process.env): LinkOAuthClient | null {
  if (env.OPEN_BANKING_MODE === 'sandbox') return new SandboxOAuthClient();
  if (!env.STITCH_CLIENT_ID) return null; // linking disabled until Stitch credentials are configured
  return new StitchOAuthClient(loadStitchConfig(env));
}

const completeSchema = z.object({
  code: z.string().min(1).max(2048),
  state: z.string().min(32).max(300),
});

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
  oauth: LinkOAuthClient | null = createOAuthClient(),
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

  /**
   * Starts the Stitch consent redirect. The PKCE verifier and nonce stay on
   * the server (encrypted), bound to this user and a single-use state.
   */
  app.post(
    '/links/stitch/start',
    asyncHandler(async (req, res) => {
      if (!oauth)
        return res
          .status(503)
          .json({ error: 'linking_unavailable', message: 'Bank linking is not available yet.' });
      const request = oauth.buildAuthorizationRequest();
      await db.createLinkState(pool, req.actingUserId!, 'stitch', request);
      return res.status(201).json({ authorizationUrl: request.authorizationUrl });
    }),
  );

  /** The web callback posts the code and state Stitch returned to it. */
  app.post(
    '/links/stitch/complete',
    asyncHandler(async (req, res) => {
      if (!oauth) return res.status(503).json({ error: 'linking_unavailable' });
      const parsed = completeSchema.safeParse(req.body);
      if (!parsed.success) return invalid(res, parsed.error);
      const userId = req.actingUserId!;
      const { codeVerifier } = await db.consumeLinkState(pool, userId, parsed.data.state);
      const tokens = await oauth.exchangeCode(parsed.data.code, codeVerifier);
      return res.status(201).json(await db.createLink(pool, userId, 'stitch', tokens));
    }),
  );

  /** DEVELOPMENT ONLY: link with a provider token supplied directly (sandbox testing). */
  app.post(
    '/links',
    asyncHandler(async (req, res) => {
      if (!isLocalEnv()) return res.status(404).json({ error: 'not_found' });
      const parsed = linkSchema.safeParse(req.body);
      if (!parsed.success) return invalid(res, parsed.error);
      return res.status(201).json(
        await db.createLink(pool, req.actingUserId!, parsed.data.source, {
          accessToken: parsed.data.accountLinkToken,
          refreshToken: null,
          expiresAt: null,
        }),
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
      let accessToken = link.accessToken;
      const expiring =
        link.expiresAt && link.expiresAt.getTime() - Date.now() < TOKEN_REFRESH_SKEW_MS;
      if (expiring && link.refreshToken && oauth) {
        try {
          const fresh = await oauth.refresh(link.refreshToken);
          await db.saveLinkTokens(pool, userId, linkId, fresh);
          accessToken = fresh.accessToken;
        } catch (err) {
          if (err instanceof OAuthExchangeError && err.reason === 'invalid_grant') {
            // The consumer revoked access at the bank/Stitch, or the refresh token expired.
            await db.expireLink(pool, userId, linkId);
            throw new db.OpenBankingError(
              409,
              'link_expired',
              'Your bank connection has expired. Please link your account again.',
            );
          }
          throw err;
        }
      }
      const feed = await adapters[link.source].fetchTransactions({
        userId,
        accountLinkToken: accessToken,
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
    if (err instanceof OAuthExchangeError) {
      return res.status(err.reason === 'invalid_grant' ? 400 : 502).json({
        error: `link_${err.reason}`,
        message: 'We couldn’t connect your bank account. Please try again.',
      });
    }
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
