import { describe, it, expect, afterAll } from 'vitest';
import { createRedisRateLimitStore } from '../redis-store';

const url = process.env.TEST_REDIS_URL;

describe.skipIf(!url)('RedisRateLimitStore (real Redis)', () => {
  const store = url ? createRedisRateLimitStore(url) : null;
  afterAll(async () => {
    await store?.close();
  });

  it('counts atomically within a window and expires', async () => {
    const key = `test-${Date.now()}`;
    const results = await Promise.all(Array.from({ length: 5 }, () => store!.increment(key, 300)));
    expect(results.map((r) => r.count).sort()).toEqual([1, 2, 3, 4, 5]);
    expect(results[0]!.resetAt).toBeGreaterThan(Date.now());
    await new Promise((r) => setTimeout(r, 400));
    expect((await store!.increment(key, 300)).count).toBe(1);
  });
});
