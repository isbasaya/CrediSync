import type { NextFunction, Request, Response } from 'express';
import { verifyToken, AuthError } from './service';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      userEmail?: string;
    }
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'missing_token', message: 'Authorization header required' });
    return;
  }

  const token = header.slice(7);
  try {
    const decoded = verifyToken(token);
    req.userId = decoded.sub;
    req.userEmail = decoded.email;
    next();
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.statusCode).json({ error: err.code, message: err.message });
      return;
    }
    res.status(401).json({ error: 'invalid_token', message: 'Could not verify token' });
  }
}
