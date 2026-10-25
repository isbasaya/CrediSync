import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import request from 'supertest';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@credisync/db';
import { setNotificationProvider, type EmailNotification } from '@credisync/notifications';
import { createApp as createGateway } from '../services/api-gateway/src/app';
import { createApp as createAuth } from '../services/auth/src/app';
import { createApp as createBureau } from '../services/bureau-ingestion/src/app';
import { createApp as createDisputes } from '../services/dispute-engine/src/app';
import { createApp as createOpenBanking } from '../services/open-banking/src/app';
import { CURRENT_POPIA_POLICY_VERSION } from '../services/auth/src/service';

const ORIGIN = 'http://localhost:3000';

function listen(app: http.RequestListener): Promise<{ url: string; server: http.Server }> {
  return new Promise((resolve) => {
    const server = http.createServer(app).listen(0, '127.0.0.1', () => {
      resolve({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server });
    });
  });
}

/** Stand-in for the Python scorer: echoes what it was sent so the test can inspect the inputs. */
function fakeScorer(received: unknown[]): http.RequestListener {
  return (req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.url === '/healthz') {
        res.end('{"status":"ok"}');
        return;
      }
      received.push(JSON.parse(body));
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          score: 61.5,
          tier: 'near_prime',
          breakdown: {},
          top_reasons: [],
          model_version: 'test',
        }),
      );
    });
  };
}

function cookiesFrom(res: request.Response): string {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  return (raw ?? []).map((c) => c.split(';')[0]).join('; ');
}

describe.skipIf(!testDatabaseAvailable)('consumer and admin journey through the gateway', () => {
  let db: TestDatabase;
  const servers: http.Server[] = [];
  let gateway: http.RequestListener;
  const emails: EmailNotification[] = [];
  const scorerInputs: unknown[] = [];

  let cookies = '';
  let mobileToken = '';

  beforeAll(async () => {
    setNotificationProvider({
      async sendEmail(n) {
        emails.push(n);
        return { success: true, channel: 'email' };
      },
      async sendSms() {
        return { success: true, channel: 'sms' };
      },
    });
    db = await createTestDatabase();
    const services = await Promise.all([
      listen(createAuth(db.pool)),
      listen(createBureau(db.pool)),
      listen(createDisputes(db.pool)),
      listen(createOpenBanking(db.pool)),
      listen(fakeScorer(scorerInputs)),
    ]);
    servers.push(...services.map((s) => s.server));
    const [auth, bureau, disputes, openBanking, scorer] = services.map((s) => s.url);
    gateway = createGateway(db.pool, {
      authUrl: auth!,
      bureauIngestionUrl: bureau!,
      disputeEngineUrl: disputes!,
      openBankingUrl: openBanking!,
      bankReadinessUrl: scorer!,
      allowedOrigins: [ORIGIN],
    });
  });

  afterAll(async () => {
    await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
    await db?.drop();
  });

  const api = () => request(gateway);

  it('signs up and keeps tokens out of the browser response body', async () => {
    const res = await api().post('/api/auth/signup').set('Origin', ORIGIN).send({
      email: 'naledi@example.co.za',
      password: 'a-long-enough-password',
      firstName: 'Naledi',
      lastName: 'Dlamini',
      mobileNumber: '+27825550100',
      saIdNumber: '8001015009087',
      popiaConsent: true,
      popiaPolicyVersion: CURRENT_POPIA_POLICY_VERSION,
      creditCheckConsent: true,
    });
    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeUndefined();
    const setCookie = (res.headers['set-cookie'] as unknown as string[]).join('\n');
    expect(setCookie).toMatch(/cs_at=.*HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Strict/i);
    cookies = cookiesFrom(res);
  });

  it('rejects cookie-authenticated writes from another origin (CSRF)', async () => {
    const res = await api()
      .post('/api/credit-profile/refresh')
      .set('Cookie', cookies)
      .set('Origin', 'https://evil.example');
    expect(res.status).toBe(403);
  });

  it('blocks bureau pulls until the email is verified', async () => {
    const res = await api()
      .post('/api/credit-profile/refresh')
      .set('Cookie', cookies)
      .set('Origin', ORIGIN);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('email_not_verified');
  });

  it('verifies the email from the link that was sent', async () => {
    const link = emails.find((e) => e.subject.includes('Confirm'))!.body;
    const token = decodeURIComponent(/token=([^\s]+)/.exec(link)![1]!);
    const res = await api().post('/api/auth/verify-email').set('Origin', ORIGIN).send({ token });
    expect(res.status).toBe(200);
    cookies = cookiesFrom(res);
  });

  it('refreshes bureau data and shows only the signed-in user their own profile', async () => {
    const refresh = await api()
      .post('/api/credit-profile/refresh')
      .set('Cookie', cookies)
      .set('Origin', ORIGIN);
    expect(refresh.status).toBe(200);
    expect(refresh.body.profile.totalAccounts).toBe(3);

    const accounts = await api().get('/api/credit-profile/accounts').set('Cookie', cookies);
    expect(accounts.status).toBe(200);
    expect(accounts.body).toHaveLength(3);
  });

  it('files and submits a dispute against an adverse account', async () => {
    const accounts = await api().get('/api/credit-profile/accounts').set('Cookie', cookies);
    const retail = accounts.body.find((a: { status: string }) => a.status === 'default');
    const create = await api()
      .post('/api/disputes')
      .set('Cookie', cookies)
      .set('Origin', ORIGIN)
      .send({
        bureauAccountId: retail.reportedBy[0].accountId,
        reason: 'settled_in_full_not_updated',
        description: 'I settled this account in full during March 2024.',
      });
    expect(create.status).toBe(201);

    const submit = await api()
      .post(`/api/disputes/${create.body.id}/submit`)
      .set('Cookie', cookies)
      .set('Origin', ORIGIN);
    expect(submit.status).toBe(200);
    expect(submit.body.status).toBe('submitted');
  });

  it("a second user cannot touch the first user's data", async () => {
    const signup = await api().post('/api/auth/signup').set('X-Client', 'mobile').send({
      email: 'sipho@example.co.za',
      password: 'another-long-password',
      firstName: 'Sipho',
      lastName: 'Mokoena',
      mobileNumber: '+27825550101',
      saIdNumber: '9202204720083',
      popiaConsent: true,
      popiaPolicyVersion: CURRENT_POPIA_POLICY_VERSION,
      creditCheckConsent: true,
    });
    expect(signup.status).toBe(201);
    mobileToken = signup.body.accessToken;
    expect(mobileToken).toBeTruthy(); // native clients receive tokens

    const theirs = await api().get('/api/disputes').set('Cookie', cookies);
    const disputeId = theirs.body.disputes[0].id;

    const bearer = { Authorization: `Bearer ${mobileToken}` };
    expect((await api().get(`/api/disputes/${disputeId}`).set(bearer)).status).toBe(404);
    expect(
      (
        await api()
          .post(`/api/disputes/${disputeId}/escalate`)
          .set(bearer)
          .send({ caseNumber: 'X' })
      ).status,
    ).toBe(404);
    expect((await api().get('/api/credit-profile/accounts').set(bearer)).body).toEqual([]);
  });

  it('keeps the admin API for staff only and audits staff access', async () => {
    expect((await api().get('/api/admin/users').set('Cookie', cookies)).status).toBe(403);

    await db.adminPool.query(
      "UPDATE credisync.users SET role = 'admin' WHERE email = 'sipho@example.co.za'",
    );
    const login = await api()
      .post('/api/auth/login')
      .set('X-Client', 'mobile')
      .send({ email: 'sipho@example.co.za', password: 'another-long-password' });
    const adminBearer = { Authorization: `Bearer ${login.body.accessToken}` };

    const users = await api().get('/api/admin/users?q=%25').set(adminBearer);
    expect(users.status).toBe(200);
    expect(users.body.users).toHaveLength(0); // '%' is escaped, not a wildcard

    const audit = await db.adminPool.query(
      "SELECT count(*)::int AS n FROM credisync.regulatory_audit_logs WHERE event_type = 'admin_access'",
    );
    expect(audit.rows[0].n).toBeGreaterThan(0);
  });

  it('scores bank readiness from stored data, ignoring anything the client sends', async () => {
    const res = await api()
      .post('/api/bank-readiness/score')
      .set('Cookie', cookies)
      .set('Origin', ORIGIN)
      .send({ unified_score: 999, judgements_count: 0, net_income: 1_000_000 });
    expect(res.status).toBe(200);
    const sent = scorerInputs.at(-1) as Record<string, number>;
    expect(sent.unified_score).not.toBe(999);
    expect(sent.net_income).toBe(0); // no bank data linked yet

    const profile = await api().get('/api/credit-profile').set('Cookie', cookies);
    expect(profile.body.bankReadinessTier).toBe('near_prime');
  });

  it('logs out and revokes the session', async () => {
    const logout = await api()
      .post('/api/auth/logout')
      .set('Cookie', cookies)
      .set('Origin', ORIGIN);
    expect(logout.status).toBe(204);
    const refresh = await api()
      .post('/api/auth/refresh')
      .set('Cookie', cookies)
      .set('Origin', ORIGIN);
    expect(refresh.status).toBe(401);
  });
});
