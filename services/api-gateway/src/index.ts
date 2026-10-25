import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import pino from 'pino';
import { authMiddleware } from './middleware';
import { securityHeaders, traceIdMiddleware, standardRateLimiter } from '@credisync/middleware';
import { adminRouter } from './admin-router';

const logger = pino({ name: 'api-gateway' });
const app = express();

app.use(securityHeaders);
app.use(traceIdMiddleware);
app.use(standardRateLimiter);
app.use(
  cors({
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
    credentials: true,
  })
);
app.use(express.json());

const SERVICE_URLS = {
  bureauIngestion: process.env.BUREAU_INGESTION_URL ?? 'http://localhost:4001',
  disputeEngine: process.env.DISPUTE_ENGINE_URL ?? 'http://localhost:4002',
  openBanking: process.env.OPEN_BANKING_URL ?? 'http://localhost:4003',
  bankReadiness: process.env.BANK_READINESS_URL ?? 'http://localhost:8000',
};

async function proxy(
  serviceUrl: string,
  path: string,
  method: string,
  body?: unknown
): Promise<{ status: number; data: unknown }> {
  const response = await fetch(`${serviceUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = response.status === 204 ? null : await response.json().catch(() => null);
  return { status: response.status, data };
}

app.get('/api/healthz', async (_req, res) => {
  const checks: Record<string, string> = {};
  for (const [name, url] of Object.entries(SERVICE_URLS)) {
    try {
      const r = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(2000) });
      checks[name] = r.ok ? 'ok' : 'unhealthy';
    } catch {
      checks[name] = 'unreachable';
    }
  }
  res.status(200).json({ status: 'ok', services: checks });
});

app.get('/api/credit-profiles/:userId', authMiddleware, async (req, res, next) => {
  try {
    if (req.userId !== req.params.userId) {
      return res.status(403).json({ error: 'forbidden' });
    }
    const { status, data } = await proxy(SERVICE_URLS.bureauIngestion, `/credit-profiles/${req.params.userId}`, 'GET');
    return res.status(status).json(data);
  } catch (err) {
    return next(err);
  }
});

app.get('/api/credit-profiles/:userId/accounts', authMiddleware, async (req, res, next) => {
  try {
    const { status, data } = await proxy(SERVICE_URLS.bureauIngestion, `/credit-profiles/${req.params.userId}/accounts`, 'GET');
    return res.status(status).json(data);
  } catch (err) {
    return next(err);
  }
});

app.post('/api/credit-profiles/:userId/refresh', authMiddleware, async (req, res, next) => {
  try {
    if (req.userId !== req.params.userId) {
      return res.status(403).json({ error: 'forbidden' });
    }
    const { status, data } = await proxy(SERVICE_URLS.bureauIngestion, `/credit-profiles/${req.params.userId}/refresh`, 'POST', req.body);
    return res.status(status).json(data);
  } catch (err) {
    return next(err);
  }
});

app.post('/api/disputes', authMiddleware, async (req, res, next) => {
  try {
    const body = { ...req.body, userId: req.userId };
    const { status, data } = await proxy(SERVICE_URLS.disputeEngine, '/disputes', 'POST', body);
    return res.status(status).json(data);
  } catch (err) {
    return next(err);
  }
});

app.post('/api/disputes/:id/submit', authMiddleware, async (req, res, next) => {
  try {
    const body = { userId: req.userId };
    const { status, data } = await proxy(SERVICE_URLS.disputeEngine, `/disputes/${req.params.id}/submit`, 'POST', body);
    return res.status(status).json(data);
  } catch (err) {
    return next(err);
  }
});

app.post('/api/disputes/:id/resolve', authMiddleware, async (req, res, next) => {
  try {
    const { status, data } = await proxy(SERVICE_URLS.disputeEngine, `/disputes/${req.params.id}/resolve`, 'POST', req.body);
    return res.status(status).json(data);
  } catch (err) {
    return next(err);
  }
});

app.post('/api/disputes/:id/escalate-ncr', authMiddleware, async (req, res, next) => {
  try {
    const { status, data } = await proxy(SERVICE_URLS.disputeEngine, `/disputes/${req.params.id}/escalate-ncr`, 'POST', req.body);
    return res.status(status).json(data);
  } catch (err) {
    return next(err);
  }
});

app.post('/api/snapshots/ingest', authMiddleware, async (req, res, next) => {
  try {
    const body = { ...req.body, userId: req.userId };
    const { status, data } = await proxy(SERVICE_URLS.openBanking, '/snapshots/ingest', 'POST', body);
    return res.status(status).json(data);
  } catch (err) {
    return next(err);
  }
});

app.post('/api/bank-readiness/score', authMiddleware, async (req, res, next) => {
  try {
    const { status, data } = await proxy(SERVICE_URLS.bankReadiness, '/score', 'POST', req.body);
    return res.status(status).json(data);
  } catch (err) {
    return next(err);
  }
});

app.use('/api/admin', adminRouter);

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, 'unhandled error in api-gateway');
  return res.status(500).json({ error: 'internal_error' });
});

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => logger.info(`api-gateway listening on :${port}`));
