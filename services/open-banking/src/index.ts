import express, { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import pino from 'pino';
import { securityHeaders, traceIdMiddleware, standardRateLimiter } from '@credisync/middleware';
import { StitchAdapter } from './adapters/stitch.adapter';
import { OzowAdapter } from './adapters/ozow.adapter';
import { buildFinancialHealthSnapshot } from './aggregation/snapshot-builder';
import { persistSnapshot } from './db';
import type { OpenBankingAdapter } from './adapters/open-banking-adapter.interface';

const logger = pino({ name: 'open-banking' });
const app = express();
app.use(securityHeaders);
app.use(traceIdMiddleware);
app.use(standardRateLimiter);
app.use(express.json());

const adaptersBySource: Record<'stitch' | 'ozow', OpenBankingAdapter> = {
  stitch: new StitchAdapter(),
  ozow: new OzowAdapter(),
};

const ingestSchema = z.object({
  userId: z.string().uuid(),
  source: z.enum(['stitch', 'ozow']),
  accountLinkToken: z.string().min(1),
  periodStart: z.string().date(),
  periodEnd: z.string().date(),
});

app.get('/healthz', (_req, res) => res.status(200).json({ status: 'ok' }));

/**
 * Pulls a transaction feed for the period, categorizes it, aggregates it
 * into a financial_health_snapshot, and persists both. Called after the
 * user service confirms `open_banking_consent = TRUE` for this user.
 */
app.post('/snapshots/ingest', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = ingestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_request', details: parsed.error.flatten() });

    const { userId, source, accountLinkToken, periodStart, periodEnd } = parsed.data;
    const adapter = adaptersBySource[source];

    const feed = await adapter.fetchTransactions({ userId, accountLinkToken, periodStart, periodEnd });
    const snapshot = buildFinancialHealthSnapshot(userId, feed);
    const snapshotId = await persistSnapshot(snapshot);

    return res.status(201).json({
      snapshotId,
      netIncome: snapshot.netIncome,
      affordabilitySurplus: snapshot.affordabilitySurplus,
      debtToIncomeRatio: snapshot.debtToIncomeRatio,
      transactionCount: snapshot.transactions.length,
    });
  } catch (err) {
    return next(err);
  }
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, 'unhandled error in open-banking service');
  return res.status(500).json({ error: 'internal_error' });
});

const port = Number(process.env.PORT ?? 4003);
app.listen(port, () => logger.info(`open-banking listening on :${port}`));
