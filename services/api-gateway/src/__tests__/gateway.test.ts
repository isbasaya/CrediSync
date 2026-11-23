import { describe, it, expect } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { forward } from '../proxy';
import type { Request, Response } from 'express';
import { deliverSession, originCheck } from '../session';
import { toFeatures } from '../bank-readiness';

function mockRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    cookies: [] as Array<{ name: string; options: Record<string, unknown> }>,
    cookie(name: string, _value: string, options: Record<string, unknown>) {
      res.cookies.push({ name, options });
      return res;
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
  };
  return res;
}

const req = (overrides: Partial<Request>) =>
  ({ method: 'POST', headers: {}, ...overrides }) as unknown as Request;

describe('originCheck', () => {
  const check = originCheck(new Set(['https://app.credisync.co.za']));

  it('blocks cookie-authenticated writes from other origins', () => {
    const res = mockRes();
    let passed = false;
    check(
      req({ headers: { cookie: 'cs_at=x', origin: 'https://evil.example' } }),
      res as unknown as Response,
      () => (passed = true),
    );
    expect(passed).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it('allows the app origin, safe methods and bearer-token clients', () => {
    const pass = (r: Request) => {
      let ok = false;
      check(r, mockRes() as unknown as Response, () => (ok = true));
      return ok;
    };
    expect(
      pass(req({ headers: { cookie: 'cs_at=x', origin: 'https://app.credisync.co.za' } })),
    ).toBe(true);
    expect(pass(req({ method: 'GET', headers: { cookie: 'cs_at=x' } }))).toBe(true);
    expect(pass(req({ headers: { authorization: 'Bearer t' } }))).toBe(true);
  });
});

describe('deliverSession', () => {
  const body = { user: { id: 'u' }, accessToken: 'a', refreshToken: 'r', expiresIn: 900 };

  it('sets httpOnly strict cookies and strips tokens for browsers', () => {
    const res = mockRes();
    deliverSession(req({}), res as unknown as Response, 200, body);
    expect(res.cookies.map((c) => c.name)).toEqual(['cs_at', 'cs_rt']);
    expect(
      res.cookies.every((c) => c.options.httpOnly === true && c.options.sameSite === 'strict'),
    ).toBe(true);
    expect(res.body).toEqual({ user: { id: 'u' }, expiresIn: 900 });
  });

  it('returns tokens in the body only for native clients', () => {
    const res = mockRes();
    deliverSession(
      req({ headers: { 'x-client': 'mobile' } }),
      res as unknown as Response,
      200,
      body,
    );
    expect((res.body as typeof body).accessToken).toBe('a');
  });
});

describe('toFeatures', () => {
  const profile = {
    unified_score: 640,
    adverse_accounts: 1,
    judgements_count: 0,
    defaults_count: 1,
    enquiries_last_12m: 2,
    total_credit_exposure: '120000.00',
    monthly_instalment: '6000.00',
  };

  it('uses the larger of bureau instalments and bank-observed debt for DTI', () => {
    const f = toFeatures(profile, {
      net_income: '20000',
      debt_repayment_total: '4000',
      overdraft_days_30d: 45,
    });
    expect(f.debt_to_income_ratio).toBe(0.3);
    expect(f.overdraft_days_30d).toBe(30); // clamped to the scorer's range
  });

  it('works without bank data', () => {
    const f = toFeatures(profile, null);
    expect(f.net_income).toBe(0);
    expect(f.debt_to_income_ratio).toBeNull();
    expect(f.unified_score).toBe(640);
  });
});

describe('forward', () => {
  it('passes cache-control through so download links are never cached', async () => {
    const upstream = http.createServer((_req, r) => {
      r.setHeader('Content-Type', 'application/json');
      r.setHeader('Cache-Control', 'no-store');
      r.end(JSON.stringify({ url: 'x', expiresIn: 300 }));
    });
    await new Promise<void>((ok) => upstream.listen(0, '127.0.0.1', ok));
    try {
      const base = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
      const headers: Record<string, string> = {};
      const res = {
        statusCode: 0,
        setHeader(k: string, v: string) {
          headers[k.toLowerCase()] = v;
        },
        status(c: number) {
          res.statusCode = c;
          return res;
        },
        json() {
          return res;
        },
        end() {
          return res;
        },
      };
      await forward(base, '/x', req({ method: 'GET' }), res as unknown as Response);
      expect(headers['cache-control']).toBe('no-store');
    } finally {
      upstream.close();
    }
  });
});
