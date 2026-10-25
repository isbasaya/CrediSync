import express, { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import pino from 'pino';
import { securityHeaders, traceIdMiddleware, standardRateLimiter } from '@credisync/middleware';
import { refreshCreditProfile } from './orchestrator';

const logger = pino({ name: 'bureau-ingestion' });
const app = express();
app.use(securityHeaders);
app.use(traceIdMiddleware);
app.use(standardRateLimiter);
app.use(express.json());

const refreshRequestSchema = z.object({
  userId: z.string().uuid(),
  saIdHash: z.string().min(1),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
});

app.get('/healthz', (_req, res) => res.status(200).json({ status: 'ok' }));

/**
 * Triggers a fresh multi-bureau pull + entity resolution for a user.
 * Called by the API gateway after POPIA open_banking_consent /
 * third_party_sharing checks have already passed — this service trusts
 * its caller for consent enforcement and focuses purely on aggregation.
 */
app.post('/credit-profiles/:userId/refresh', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = refreshRequestSchema.safeParse({ ...req.body, userId: req.params.userId });
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_request', details: parsed.error.flatten() });
    }

    const result = await refreshCreditProfile(parsed.data);

    const status = result.bureauFailures.length > 0 ? 207 : 200; // 207 Multi-Status: partial bureau failure
    return res.status(status).json({
      creditProfileId: result.creditProfileId,
      unifiedScore: result.profile.unifiedScore,
      unifiedScoreBand: result.profile.unifiedScoreBand,
      totalAccounts: result.profile.totalAccounts,
      bureauFailures: result.bureauFailures,
    });
  } catch (err) {
    return next(err);
  }
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, 'unhandled error in bureau-ingestion service');
  res.status(500).json({ error: 'internal_error' });
});

const port = Number(process.env.PORT ?? 4001);
app.listen(port, () => logger.info(`bureau-ingestion listening on :${port}`));
