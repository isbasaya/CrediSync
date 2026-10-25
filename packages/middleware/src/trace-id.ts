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

export function traceIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers['x-trace-id'] as string | undefined;
  const traceId = incoming ?? randomUUID();
  req.traceId = traceId;
  res.setHeader('X-Trace-Id', traceId);
  next();
}
