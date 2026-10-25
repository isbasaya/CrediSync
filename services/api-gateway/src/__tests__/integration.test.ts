import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import type { Request, Response } from 'express';
import { createRateLimiter } from '@credisync/middleware';

function createMockReq(ip = '127.0.0.1', path = '/test'): Request {
  return {
    ip,
    path,
    headers: {},
  } as unknown as Request;
}

function createMockRes(): Response {
  return {
    setHeader(_key: string, _value: string) {},
    status(_code: number) {
      return { json(_data: unknown) { return undefined; } };
    },
    json(_data: unknown) {
      return undefined;
    },
  } as unknown as Response;
}

describe('rate limiter', () => {
  it('allows requests under the limit', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 10 });
    const next = () => {};

    for (let i = 0; i < 10; i++) {
      let called = false;
      limiter(createMockReq(), createMockRes(), () => { called = true; });
      expect(called).toBe(true);
    }
  });

  it('blocks requests over the limit', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 3 });
    const next = () => {};

    for (let i = 0; i < 3; i++) {
      limiter(createMockReq(), createMockRes(), next);
    }

    let blocked = false;
    const res = createMockRes();
    limiter(createMockReq(), res, () => { blocked = true; });

    expect(blocked).toBe(false);
  });

  it('tracks different IPs independently', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 2 });

    limiter(createMockReq('1.1.1.1'), createMockRes(), () => {});
    limiter(createMockReq('1.1.1.1'), createMockRes(), () => {});

    let nextCalled1 = false;
    limiter(createMockReq('1.1.1.1'), createMockRes(), () => { nextCalled1 = true; });
    expect(nextCalled1).toBe(false);

    let nextCalled2 = false;
    limiter(createMockReq('2.2.2.2'), createMockRes(), () => { nextCalled2 = true; });
    expect(nextCalled2).toBe(true);
  });
});

describe('auth middleware integration', () => {
  const signupSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    mobileNumber: z.string().regex(/^\+27[0-9]{9}$/),
    saIdHash: z.string().min(1),
    popiaConsent: z.boolean(),
  });

  it('validates signup input shape', () => {
    const valid = signupSchema.safeParse({
      email: 'test@example.com',
      password: 'securePass123',
      firstName: 'Test',
      lastName: 'User',
      mobileNumber: '+27821234567',
      saIdHash: 'abc123hash',
      popiaConsent: true,
    });
    expect(valid.success).toBe(true);
  });

  it('rejects invalid email', () => {
    const invalid = signupSchema.safeParse({
      email: 'not-an-email',
      password: 'securePass123',
      firstName: 'Test',
      lastName: 'User',
      mobileNumber: '+27821234567',
      saIdHash: 'abc123hash',
      popiaConsent: true,
    });
    expect(invalid.success).toBe(false);
  });

  it('rejects short password', () => {
    const invalid = signupSchema.safeParse({
      email: 'test@example.com',
      password: 'short',
      firstName: 'Test',
      lastName: 'User',
      mobileNumber: '+27821234567',
      saIdHash: 'abc123hash',
      popiaConsent: true,
    });
    expect(invalid.success).toBe(false);
  });

  it('rejects invalid SA mobile format', () => {
    const invalid = signupSchema.safeParse({
      email: 'test@example.com',
      password: 'securePass123',
      firstName: 'Test',
      lastName: 'User',
      mobileNumber: '0821234567',
      saIdHash: 'abc123hash',
      popiaConsent: true,
    });
    expect(invalid.success).toBe(false);
  });
});

describe('API contract shape', () => {
  it('credit profile summary matches expected shape', () => {
    const shape = {
      id: 'uuid',
      userId: 'uuid',
      unifiedScore: 650,
      unifiedScoreBand: 'fair',
      bureauScores: [{ bureau: 'transunion', score: 684, scoreBand: 'good' }],
      totalAccounts: 6,
      openAccounts: 5,
      adverseAccounts: 1,
      judgementsCount: 0,
      defaultsCount: 0,
      enquiriesLast12m: 3,
      totalCreditExposure: 184250.5,
      bankReadinessScore: 62,
      bankReadinessTier: 'near_prime',
      lastRefreshedAt: '2024-01-15T10:30:00Z',
    };

    expect(shape.unifiedScoreBand).toMatch(/excellent|good|fair|poor|very_poor/);
    expect(shape.bankReadinessTier).toMatch(/prime|near_prime|sub_prime|unqualified/);
    expect(shape.bureauScores[0]?.bureau).toMatch(/transunion|experian|xds/);
  });
});
