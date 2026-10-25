import { describe, it, expect, vi, afterEach } from 'vitest';
import { ApiError, describeError, getCreditProfile } from '../api-client';
import { DISPUTE_REASON_LABELS, DISPUTE_STATUS_LABELS } from '../types';
import { accountStatusTokens } from '../../../../design-system/tokens';

afterEach(() => vi.unstubAllGlobals());

describe('describeError', () => {
  it('turns known error codes into plain-language next steps', () => {
    expect(describeError(new ApiError(403, 'email_not_verified', ''), 'fallback')).toMatch(
      /Confirm your email/,
    );
  });

  it('never shows raw server errors for 5xx responses', () => {
    expect(
      describeError(
        new ApiError(500, 'internal_error', 'stack trace here'),
        'We couldn’t do that.',
      ),
    ).toBe('We couldn’t do that.');
  });
});

describe('request', () => {
  it('sends cookies, and refreshes the session once on 401 before retrying', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push(url);
        expect(init.credentials).toBe('include');
        if (url.endsWith('/credit-profile') && calls.length === 1)
          return new Response('{"error":"invalid_token"}', { status: 401 });
        if (url.endsWith('/auth/refresh')) return new Response('{}', { status: 200 });
        return new Response('{"id":"p1"}', { status: 200 });
      }),
    );
    await expect(getCreditProfile()).resolves.toEqual({ id: 'p1' });
    expect(calls.map((c) => c.split('/api')[1])).toEqual([
      '/credit-profile',
      '/auth/refresh',
      '/credit-profile',
    ]);
  });
});

describe('labels', () => {
  it('cover every enum value the API can return', () => {
    expect(Object.keys(DISPUTE_REASON_LABELS)).toHaveLength(9);
    expect(Object.keys(DISPUTE_STATUS_LABELS)).toHaveLength(6);
    expect(Object.keys(accountStatusTokens)).toEqual([
      'current',
      'arrears',
      'default',
      'judgement',
      'written_off',
      'unknown',
    ]);
  });
});
