import express, { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import pino from 'pino';
import { securityHeaders, traceIdMiddleware, standardRateLimiter } from '@credisync/middleware';
import * as service from './service';
import { InvalidTransitionError } from './state-machine';

const logger = pino({ name: 'dispute-engine' });
const app = express();
app.use(securityHeaders);
app.use(traceIdMiddleware);
app.use(standardRateLimiter);
app.use(express.json());

const disputeReasons = [
  'not_my_account',
  'incorrect_balance',
  'incorrect_status',
  'paid_but_reflecting_outstanding',
  'duplicate_listing',
  'identity_theft_fraud',
  'settled_in_full_not_updated',
  'prescribed_debt',
  'incorrect_personal_details',
] as const;

const createDisputeSchema = z.object({
  userId: z.string().uuid(),
  bureauAccountId: z.string().uuid(),
  bureau: z.enum(['transunion', 'experian', 'xds']),
  reason: z.enum(disputeReasons),
  description: z.string().min(20, 'description must give the bureau enough detail to investigate'),
  evidenceKeys: z.array(z.string()).default([]),
  maskedSaId: z.string(),
});

app.get('/healthz', (_req, res) => res.status(200).json({ status: 'ok' }));

app.post('/disputes', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = createDisputeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_request', details: parsed.error.flatten() });

    const result = await service.createDispute(parsed.data);
    return res.status(201).json(result);
  } catch (err) {
    return next(err);
  }
});

app.post('/disputes/:id/regenerate-letter', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({ description: z.string().min(20), maskedSaId: z.string() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_request', details: parsed.error.flatten() });

    const letter = await service.regenerateLetter(req.params.id, parsed.data.description, parsed.data.maskedSaId);
    return res.status(200).json({ letter });
  } catch (err) {
    return next(err);
  }
});

app.post('/disputes/:id/submit', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({ userId: z.string().uuid() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_request', details: parsed.error.flatten() });

    const result = await service.submitDispute(req.params.id, parsed.data.userId);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
});

app.post('/disputes/:id/bureau-response', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({ response: z.string().min(1), reference: z.string().nullable().default(null) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_request', details: parsed.error.flatten() });

    await service.recordBureauResponse(req.params.id, parsed.data.response, parsed.data.reference);
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

app.post('/disputes/:id/resolve', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({ upheld: z.boolean() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_request', details: parsed.error.flatten() });

    await service.resolveDispute(req.params.id, parsed.data.upheld);
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

app.post('/disputes/:id/escalate-ncr', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({ caseNumber: z.string().min(1) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_request', details: parsed.error.flatten() });

    await service.escalateToNcr(req.params.id, parsed.data.caseNumber);
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

const webhookSchema = z.object({
  disputeId: z.string().uuid(),
  bureau: z.enum(['transunion', 'experian', 'xds']),
  response: z.string().min(1),
  reference: z.string().nullable().default(null),
  resolution: z.enum(['upheld', 'rejected']).nullable().default(null),
});

app.post('/webhooks/bureau-response', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = webhookSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_request', details: parsed.error.flatten() });

    const { disputeId, response, reference, resolution } = parsed.data;

    await service.recordBureauResponse(disputeId, response, reference);

    if (resolution === 'upheld') {
      await service.resolveDispute(disputeId, true);
    } else if (resolution === 'rejected') {
      await service.resolveDispute(disputeId, false);
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    return next(err);
  }
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof InvalidTransitionError) {
    return res.status(409).json({ error: 'invalid_transition', message: err.message });
  }
  logger.error({ err }, 'unhandled error in dispute-engine service');
  return res.status(500).json({ error: 'internal_error' });
});

const port = Number(process.env.PORT ?? 4002);
app.listen(port, () => logger.info(`dispute-engine listening on :${port}`));
