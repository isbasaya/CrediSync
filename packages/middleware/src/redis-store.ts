import type { RateLimitStore } from './rate-limiter';

/**
 * Shared rate-limit counters in Redis (ElastiCache in production) so limits
 * hold across every gateway replica. INCR and the first PEXPIRE happen in
 * one Lua script, so a crash between them can never leave a key without an
 * expiry (which would block that client forever).
 */
const INCREMENT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); ttl = tonumber(ARGV[1]) end
return {count, ttl}
`;

interface RedisLike {
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
  quit(): Promise<unknown>;
}

export class RedisRateLimitStore implements RateLimitStore {
  constructor(
    private readonly redis: RedisLike,
    private readonly prefix = 'credisync:rl:',
  ) {}

  async increment(key: string, windowMs: number): Promise<{ count: number; resetAt: number }> {
    const [count, ttl] = (await this.redis.eval(
      INCREMENT_SCRIPT,
      1,
      `${this.prefix}${key}`,
      windowMs,
    )) as [number, number];
    return { count: Number(count), resetAt: Date.now() + Number(ttl) };
  }

  close(): Promise<unknown> {
    return this.redis.quit();
  }
}

/** Connects with ioredis (TLS when the URL is rediss://, as on ElastiCache with in-transit encryption). */
export function createRedisRateLimitStore(url: string): RedisRateLimitStore {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const IORedis = require('ioredis') as typeof import('ioredis').default;
  const client = new IORedis(url, {
    // Queue briefly while (re)connecting, but give up fast: the limiter fails open.
    maxRetriesPerRequest: 1,
    commandTimeout: 250,
  });
  // Errors surface per request (and the limiter fails open); avoid unhandled 'error' events.
  client.on('error', () => undefined);
  return new RedisRateLimitStore(client);
}
