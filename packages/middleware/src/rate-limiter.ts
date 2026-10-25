export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export function createRateLimiter(config: RateLimitConfig) {
  const { windowMs, maxRequests } = config;
  const stores = new Map<string, Map<string, RateLimitEntry>>();

  return (req: import('express').Request, res: import('express').Response, next: import('express').NextFunction): void => {
    const key = req.ip ?? 'unknown';
    const path = req.path;

    let pathStore = stores.get(path);
    if (!pathStore) {
      pathStore = new Map();
      stores.set(path, pathStore);
    }

    const now = Date.now();
    let entry = pathStore.get(key);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 1, resetAt: now + windowMs };
      pathStore.set(key, entry);
    } else {
      entry.count += 1;
    }

    res.setHeader('X-RateLimit-Limit', String(maxRequests));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, maxRequests - entry.count)));
    res.setHeader('X-RateLimit-Reset', new Date(entry.resetAt).toISOString());

    if (entry.count > maxRequests) {
      res.status(429).json({
        error: 'rate_limit_exceeded',
        message: `Too many requests. Limit: ${maxRequests} per ${windowMs / 1000}s`,
        retryAfter: Math.ceil((entry.resetAt - now) / 1000),
      });
      return;
    }

    next();
  };
}

export const standardRateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 100 });
export const strictRateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 10 });
