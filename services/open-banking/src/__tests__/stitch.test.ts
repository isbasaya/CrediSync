import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHash } from 'crypto';
import { OAuthExchangeError, StitchOAuthClient, STITCH_TOKEN_URL } from '../providers/stitch-oauth';
import { StitchAdapter } from '../adapters/stitch.adapter';

const config = {
  clientId: 'client-123',
  clientSecret: 'secret-secret-secret',
  redirectUri: 'https://app.credisync.co.za/bank/callback',
};

afterEach(() => vi.unstubAllGlobals());

describe('StitchOAuthClient', () => {
  it('builds an authorization URL with PKCE S256, state and nonce', () => {
    const req = new StitchOAuthClient(config).buildAuthorizationRequest();
    const url = new URL(req.authorizationUrl);
    expect(url.origin + url.pathname).toBe('https://secure.stitch.money/connect/authorize');
    const p = url.searchParams;
    expect(p.get('response_type')).toBe('code');
    expect(p.get('scope')).toBe('openid offline_access accounts transactions balances');
    expect(p.get('code_challenge_method')).toBe('S256');
    expect(p.get('code_challenge')).toBe(
      createHash('sha256').update(req.codeVerifier).digest('base64url'),
    );
    expect(p.get('state')).toBe(req.state);
    expect(req.state.length).toBeGreaterThanOrEqual(32);
    expect(req.codeVerifier).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/);
  });

  it('exchanges a code with the verifier and client secret', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_in: 900 }), {
          status: 200,
        }),
    );
    const tokens = await new StitchOAuthClient(
      config,
      fetchMock as unknown as typeof fetch,
    ).exchangeCode('the-code', 'verifier');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(STITCH_TOKEN_URL);
    const body = new URLSearchParams(init.body as string);
    expect(Object.fromEntries(body)).toMatchObject({
      grant_type: 'authorization_code',
      code: 'the-code',
      code_verifier: 'verifier',
      client_id: 'client-123',
      client_secret: 'secret-secret-secret',
      redirect_uri: config.redirectUri,
    });
    expect(tokens.refreshToken).toBe('rt');
    expect(tokens.expiresAt.getTime()).toBeGreaterThan(Date.now() + 800_000);
  });

  it('reports a rejected grant distinctly from provider outages', async () => {
    const rejected = vi.fn(async () => new Response('{"error":"invalid_grant"}', { status: 400 }));
    await expect(
      new StitchOAuthClient(config, rejected as unknown as typeof fetch).refresh('old'),
    ).rejects.toMatchObject({
      reason: 'invalid_grant',
    });
    const down = vi.fn(async () => new Response('', { status: 503 }));
    await expect(
      new StitchOAuthClient(config, down as unknown as typeof fetch).refresh('old'),
    ).rejects.toBeInstanceOf(OAuthExchangeError);
  });
});

describe('StitchAdapter', () => {
  const tx = (id: string, date: string, quantity: string, balance: string) => ({
    node: {
      id,
      amount: { quantity, currency: 'ZAR' },
      date,
      description: `TX ${id}`,
      reference: null,
      runningBalance: { quantity: balance, currency: 'ZAR' },
    },
  });

  it('pages newest-first, stops at the period start, and derives closing balances', async () => {
    const calls: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string) as {
          query: string;
          variables: Record<string, unknown>;
        };
        calls.push(body.variables);
        if (body.query.includes('CrediSyncAccounts')) {
          return Response.json({
            data: { user: { bankAccounts: [{ id: 'acc-1', name: 'Cheque' }] } },
          });
        }
        if (!body.variables.after) {
          return Response.json({
            data: {
              node: {
                transactions: {
                  pageInfo: { hasNextPage: true, endCursor: 'c1' },
                  edges: [
                    tx('t4', '2026-09-02', '-100.00', '900.00'),
                    tx('t3', '2026-09-02', '-50.00', '1000.00'),
                    tx('t2', '2026-08-25', '25000.00', '1050.00'),
                  ],
                },
              },
            },
          });
        }
        return Response.json({
          data: {
            node: {
              transactions: {
                pageInfo: { hasNextPage: true, endCursor: 'c2' },
                edges: [
                  tx('t1', '2026-08-01', '-200.00', '-23950.00'),
                  tx('t0', '2026-07-30', '-1.00', '-23750.00'),
                ],
              },
            },
          },
        });
      }),
    );

    const feed = await new StitchAdapter('https://api.stitch.money/graphql').fetchTransactions({
      userId: 'u',
      accountLinkToken: 'token',
      periodStart: '2026-08-01',
      periodEnd: '2026-09-30',
    });

    expect(feed.transactions.map((t) => t.providerTransactionId)).toEqual(['t4', 't3', 't2', 't1']);
    expect(feed.transactions[2]!.amount).toBe(25000);
    expect(calls.filter((c) => 'accountId' in c)).toHaveLength(2); // stopped after reaching July
    expect(feed.closingBalances).toEqual([
      { date: '2026-08-01', balance: -23950 },
      { date: '2026-08-25', balance: 1050 },
      { date: '2026-09-02', balance: 900 },
    ]);
  });

  it('treats an unauthorised response as revoked consent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 401 })),
    );
    await expect(
      new StitchAdapter('https://api.stitch.money/graphql').fetchTransactions({
        userId: 'u',
        accountLinkToken: 't',
        periodStart: '2026-08-01',
        periodEnd: '2026-08-31',
      }),
    ).rejects.toMatchObject({ cause: 'consent_revoked' });
  });
});
