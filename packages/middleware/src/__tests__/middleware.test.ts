import { describe, it, expect, afterEach } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { createRateLimiter, MemoryRateLimitStore, normaliseRoute } from '../rate-limiter';
import { traceIdMiddleware } from '../trace-id';
import { requireInternalToken, internalServiceToken } from '../internal-auth';
import { asyncHandler } from '../async-handler';

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    ip: '10.0.0.1',
    path: '/x',
    method: 'GET',
    headers: {},
    ...overrides,
  } as unknown as Request;
}

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    setHeader(k: string, v: string) {
      res.headers[k] = v;
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(b: unknown) {
      res.body = b;
      return res;
    },
  };
  return res;
}

const flush = () => new Promise((r) => setImmediate(r));

describe('rate limiter', () => {
  const stores: MemoryRateLimitStore[] = [];
  afterEach(() => stores.splice(0).forEach((s) => s.close()));

  it('blocks once the limit is exceeded and sets Retry-After', async () => {
    const store = new MemoryRateLimitStore();
    stores.push(store);
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 2, store });
    let passed = 0;
    const res = mockRes();
    for (let i = 0; i < 3; i++) limiter(mockReq(), res as unknown as Response, () => passed++);
    await flush();
    expect(passed).toBe(2);
    expect(res.statusCode).toBe(429);
    expect(res.headers['Retry-After']).toBeDefined();
  });

  it('shares one bucket per client across different ids in the path', async () => {
    const store = new MemoryRateLimitStore();
    stores.push(store);
    const limiter = createRateLimiter({
      windowMs: 60_000,
      maxRequests: 100,
      perRoute: true,
      store,
    });
    for (let i = 0; i < 50; i++) {
      const id = `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`;
      limiter(
        mockReq({ path: `/credit-profiles/${id}` }),
        mockRes() as unknown as Response,
        () => undefined,
      );
    }
    await flush();
    expect(store.size).toBe(1);
  });

  it('sweeps expired entries so memory does not grow without bound', async () => {
    const store = new MemoryRateLimitStore();
    stores.push(store);
    await store.increment('a', 1);
    await store.increment('b', 1);
    store.sweep(Date.now() + 10);
    expect(store.size).toBe(0);
  });

  it('normalises uuid and numeric path segments', () => {
    expect(normaliseRoute('/api/disputes/11111111-1111-4111-8111-111111111111/submit')).toBe(
      '/api/disputes/:id/submit',
    );
    expect(normaliseRoute('/admin/users/42')).toBe('/admin/users/:n');
  });
});

describe('traceIdMiddleware', () => {
  it('keeps a well-formed incoming id', () => {
    const req = mockReq({ headers: { 'x-trace-id': 'abc12345-trace' } });
    traceIdMiddleware(req, mockRes() as unknown as Response, () => undefined);
    expect(req.traceId).toBe('abc12345-trace');
  });

  it('replaces an id that could inject into logs', () => {
    const req = mockReq({ headers: { 'x-trace-id': 'bad\nid injected' } });
    traceIdMiddleware(req, mockRes() as unknown as Response, () => undefined);
    expect(req.traceId).not.toContain('\n');
  });
});

describe('requireInternalToken', () => {
  it('rejects a missing or wrong token', () => {
    const res = mockRes();
    let called = false;
    requireInternalToken(
      mockReq({ headers: { 'x-internal-token': 'nope' } }),
      res as unknown as Response,
      () => {
        called = true;
      },
    );
    expect(called).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it('accepts the token and reads the acting user from headers only', () => {
    const req = mockReq({
      headers: {
        'x-internal-token': internalServiceToken(),
        'x-acting-user-id': '11111111-1111-4111-8111-111111111111',
        'x-acting-user-role': 'consumer',
      },
    });
    let called = false;
    requireInternalToken(req, mockRes() as unknown as Response, () => {
      called = true;
    });
    expect(called).toBe(true);
    expect(req.actingUserId).toBe('11111111-1111-4111-8111-111111111111');
    expect(req.actingUserRole).toBe('consumer');
  });
});

describe('asyncHandler', () => {
  it('forwards rejections to next()', async () => {
    let received: unknown;
    const handler = asyncHandler(async () => {
      throw new Error('boom');
    });
    handler(
      mockReq(),
      mockRes() as unknown as Response,
      ((err: unknown) => {
        received = err;
      }) as NextFunction,
    );
    await flush();
    expect((received as Error).message).toBe('boom');
  });
});

import jwt from 'jsonwebtoken';
import { requireAuth, requireRole, signAccessToken, verifyAccessToken } from '../jwt';

describe('access tokens', () => {
  const claims = {
    sub: '11111111-1111-4111-8111-111111111111',
    email: 'a@b.co',
    role: 'consumer' as const,
    verified: true,
  };

  it('round-trips claims', () => {
    expect(verifyAccessToken(signAccessToken(claims))).toEqual({
      id: claims.sub,
      email: 'a@b.co',
      role: 'consumer',
      verified: true,
    });
  });

  it('rejects tokens with the wrong audience or algorithm', () => {
    const wrongAud = jwt.sign(
      { email: 'a', role: 'consumer' },
      'credisync-dev-jwt-secret-not-for-production-use',
      {
        subject: claims.sub,
        issuer: 'credisync-auth',
        audience: 'something-else',
      },
    );
    expect(() => verifyAccessToken(wrongAud)).toThrow();
    const none = jwt.sign({ email: 'a', role: 'admin', sub: claims.sub }, '', {
      algorithm: 'none',
    });
    expect(() => verifyAccessToken(none)).toThrow();
  });

  it('accepts the access cookie and enforces roles', () => {
    const token = signAccessToken(claims);
    const req = mockReq({ headers: { cookie: `other=1; cs_at=${token}` } });
    let ok = false;
    requireAuth(req, mockRes() as unknown as Response, () => (ok = true));
    expect(ok).toBe(true);
    expect(req.authVia).toBe('cookie');

    const res = mockRes();
    let admitted = false;
    requireRole('admin')(req, res as unknown as Response, () => (admitted = true));
    expect(admitted).toBe(false);
    expect(res.statusCode).toBe(403);
  });
});
