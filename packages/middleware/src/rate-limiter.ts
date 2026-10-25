import { createRedisRateLimitStore } from './redis-store';
import type { NextFunction, Request, Response } from 'express';

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  /** Separate buckets per route (normalised) instead of one per client. */
  perRoute?: boolean;
  /** Custom bucket key, e.g. by authenticated user id. */
  keyGenerator?: (req: Request) => string;
  store?: RateLimitStore;
}

export interface RateLimitStore {
  /** Atomically increments the counter for key and returns the new count and window reset time. */
  increment(key: string, windowMs: number): Promise<{ count: number; resetAt: number }>;
}

/**
 * Single-process store. Fine for one instance and for tests; with more than
 * one replica plug in a shared store (e.g. Redis INCR + PEXPIRE) so limits
 * hold across the fleet.
 */
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly entries = new Map<string, { count: number; resetAt: number }>();
  private readonly sweeper: NodeJS.Timeout;

  constructor(sweepIntervalMs = 60_000) {
    this.sweeper = setInterval(() => this.sweep(), sweepIntervalMs);
    this.sweeper.unref();
  }

  async increment(key: string, windowMs: number): Promise<{ count: number; resetAt: number }> {
    const now = Date.now();
    const existing = this.entries.get(key);
    if (!existing || existing.resetAt <= now) {
      const fresh = { count: 1, resetAt: now + windowMs };
      this.entries.set(key, fresh);
      return { ...fresh };
    }
    existing.count += 1;
    return { count: existing.count, resetAt: existing.resetAt };
  }

  sweep(now = Date.now()): void {
    for (const [key, entry] of this.entries) {
      if (entry.resetAt <= now) this.entries.delete(key);
    }
  }

  get size(): number {
    return this.entries.size;
  }

  close(): void {
    clearInterval(this.sweeper);
  }
}

const UUID_SEGMENT = /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi;
const NUMERIC_SEGMENT = /\/\d+(?=\/|$)/g;

/** Collapses ids so /credit-profiles/<uuid>/refresh shares one bucket for every user id. */
export function normaliseRoute(path: string): string {
  return path.replace(UUID_SEGMENT, '/:id').replace(NUMERIC_SEGMENT, '/:n');
}

let sharedStore: RateLimitStore | null = null;

/**
 * Redis when REDIS_URL is set (required for more than one replica),
 * otherwise one in-process store shared by every limiter.
 */
export function defaultRateLimitStore(env: NodeJS.ProcessEnv = process.env): RateLimitStore {
  if (!sharedStore) {
    if (env.REDIS_URL) {
      sharedStore = createRedisRateLimitStore(env.REDIS_URL);
    } else {
      sharedStore = new MemoryRateLimitStore();
    }
  }
  return sharedStore;
}

export function createRateLimiter(config: RateLimitConfig) {
  const { windowMs, maxRequests } = config;
  // Resolved on first use so REDIS_URL from the environment is honoured.
  let store: RateLimitStore | undefined = config.store;
  const getStore = () => (store ??= defaultRateLimitStore());

  return (req: Request, res: Response, next: NextFunction): void => {
    const client = config.keyGenerator ? config.keyGenerator(req) : (req.ip ?? 'unknown');
    // Namespaced by limit settings so limiters sharing one store never share counters.
    const scope = `${windowMs}:${maxRequests}${config.perRoute ? `:${req.method}|${normaliseRoute(req.path)}` : ''}`;
    const key = `${scope}|${client}`;

    getStore()
      .increment(key, windowMs)
      .then(({ count, resetAt }) => {
        res.setHeader('X-RateLimit-Limit', String(maxRequests));
        res.setHeader('X-RateLimit-Remaining', String(Math.max(0, maxRequests - count)));
        res.setHeader('X-RateLimit-Reset', new Date(resetAt).toISOString());

        if (count > maxRequests) {
          const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
          res.setHeader('Retry-After', String(retryAfter));
          res.status(429).json({
            error: 'rate_limit_exceeded',
            message: `Too many requests. Limit: ${maxRequests} per ${windowMs / 1000}s`,
            retryAfter,
          });
          return;
        }
        next();
      })
      // A broken limiter store must not take the API down; fail open and let monitoring alert.
      .catch(() => next());
  };
}

/** General traffic: 100 requests/minute per client across all routes. */
export const standardRateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 100 });
/** Credential endpoints: 10 requests/minute per client per route. */
export const strictRateLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 10,
  perRoute: true,
});
