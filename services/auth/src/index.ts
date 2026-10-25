import express, { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import pino from 'pino';
import { securityHeaders, traceIdMiddleware, standardRateLimiter, strictRateLimiter } from '@credisync/middleware';
import { signup, login, AuthError } from './service';
import { authMiddleware } from './middleware';
import { pool } from './db';

const logger = pino({ name: 'auth-service' });
const app = express();
app.use(securityHeaders);
app.use(traceIdMiddleware);
app.use(standardRateLimiter);
app.use(express.json());

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'password must be at least 8 characters'),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  mobileNumber: z.string().regex(/^\+27[0-9]{9}$/, 'must be a valid SA mobile number (+27...)'),
  saIdHash: z.string().min(1),
  popiaConsent: z.boolean(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

app.get('/healthz', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ status: 'ok', database: 'connected' });
  } catch {
    res.status(503).json({ status: 'degraded', database: 'disconnected' });
  }
});

app.post('/auth/signup', strictRateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_request', details: parsed.error.flatten() });
    }

    const result = await signup(parsed.data);
    return res.status(201).json(result);
  } catch (err) {
    return next(err);
  }
});

app.post('/auth/login', strictRateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_request', details: parsed.error.flatten() });
    }

    const result = await login(parsed.data.email, parsed.data.password);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
});

app.get('/auth/me', authMiddleware, async (req: Request, res: Response) => {
  res.status(200).json({ userId: req.userId, email: req.userEmail });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AuthError) {
    return res.status(err.statusCode).json({ error: err.code, message: err.message });
  }
  logger.error({ err }, 'unhandled error in auth service');
  return res.status(500).json({ error: 'internal_error' });
});

const port = Number(process.env.PORT ?? 4004);
app.listen(port, () => logger.info(`auth-service listening on :${port}`));
