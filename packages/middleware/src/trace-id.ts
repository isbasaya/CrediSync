import { randomUUID } from 'crypto';
import type { Request, Response, NextFunction } from 'express';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      traceId?: string;
    }
  }
}

/** Accept only short, header-safe ids from upstream so a caller can't inject into logs. */
const TRACE_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

export function traceIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers['x-trace-id'];
  const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
  const traceId = candidate && TRACE_ID_PATTERN.test(candidate) ? candidate : randomUUID();
  req.traceId = traceId;
  res.setHeader('X-Trace-Id', traceId);
  next();
}
