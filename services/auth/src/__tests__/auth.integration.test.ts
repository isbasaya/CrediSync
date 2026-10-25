import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@credisync/db';
import { internalHeaders, verifyAccessToken } from '@credisync/middleware';
import { createApp } from '../app';
import { CURRENT_POPIA_POLICY_VERSION } from '../service';

const VALID_ID = '8001015009087';

describe.skipIf(!testDatabaseAvailable)('auth service (real Postgres)', () => {
  let db: TestDatabase;
  let app: ReturnType<typeof createApp>;
  const internal = () => internalHeaders();

  const signupBody = (overrides: Record<string, unknown> = {}) => ({
    email: 'Thandi@Example.co.za',
    password: 'correct-horse-battery',
    firstName: 'Thandi',
    lastName: 'Nkosi',
    mobileNumber: '+27821234567',
    saIdNumber: VALID_ID,
    popiaConsent: true,
    popiaPolicyVersion: CURRENT_POPIA_POLICY_VERSION,
    creditCheckConsent: true,
    ...overrides,
  });

  beforeAll(async () => {
    db = await createTestDatabase();
    app = createApp(db.pool);
  }, 60_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('rejects calls that do not come from the gateway', async () => {
    const res = await request(app).post('/auth/login').send({ email: 'a@b.co', password: 'x' });
    expect(res.status).toBe(401);
  });

  it('requires POPIA consent and a valid SA ID', async () => {
    const noConsent = await request(app)
      .post('/auth/signup')
      .set(internal())
      .send(signupBody({ popiaConsent: false }));
    expect(noConsent.status).toBe(400);

    const badId = await request(app)
      .post('/auth/signup')
      .set(internal())
      .send(signupBody({ saIdNumber: '8001015009088' }));
    expect(badId.status).toBe(400);
    expect(badId.body.error).toBe('invalid_sa_id');
  });

  let refreshToken: string;
  let userId: string;

  it('signs up, encrypts the SA ID, records consent and starts unverified', async () => {
    const res = await request(app).post('/auth/signup').set(internal()).send(signupBody());
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe('thandi@example.co.za');
    expect(res.body.user.is_verified).toBe(false);
    expect(res.body.user.role).toBe('consumer');
    expect(verifyAccessToken(res.body.accessToken).verified).toBe(false);
    refreshToken = res.body.refreshToken;
    userId = res.body.user.id;

    const stored = await db.adminPool.query(
      'SELECT sa_id_encrypted, sa_id_hash FROM credisync.users WHERE id = $1',
      [userId],
    );
    const raw = Buffer.from(stored.rows[0].sa_id_encrypted).toString('utf-8');
    expect(raw).not.toContain(VALID_ID);
    expect(stored.rows[0].sa_id_hash).not.toContain(VALID_ID);

    const consents = await db.adminPool.query(
      'SELECT consent_type, new_value, policy_version FROM credisync.popia_consent_audit WHERE user_id = $1 ORDER BY id',
      [userId],
    );
    expect(consents.rows.map((r) => r.consent_type)).toEqual([
      'popia',
      'credit_check',
      'marketing',
    ]);
    expect(consents.rows[0].policy_version).toBe(CURRENT_POPIA_POLICY_VERSION);
  });

  it('refuses a second account for the same email or SA ID with one generic message', async () => {
    const sameId = await request(app)
      .post('/auth/signup')
      .set(internal())
      .send(signupBody({ email: 'other@example.co.za' }));
    expect(sameId.status).toBe(409);
    expect(sameId.body.error).toBe('account_exists');
  });

  it('logs in case-insensitively and fails generically on a bad password', async () => {
    const ok = await request(app)
      .post('/auth/login')
      .set(internal())
      .send({ email: 'THANDI@example.co.za', password: 'correct-horse-battery' });
    expect(ok.status).toBe(200);

    const bad = await request(app)
      .post('/auth/login')
      .set(internal())
      .send({ email: 'thandi@example.co.za', password: 'wrong-password!' });
    const unknown = await request(app)
      .post('/auth/login')
      .set(internal())
      .send({ email: 'nobody@example.co.za', password: 'wrong-password!' });
    expect(bad.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(bad.body).toEqual(unknown.body);
  });

  it('rotates refresh tokens and revokes the family when an old token is replayed', async () => {
    const first = await request(app).post('/auth/refresh').set(internal()).send({ refreshToken });
    expect(first.status).toBe(200);
    const next = first.body.refreshToken as string;
    expect(next).not.toBe(refreshToken);

    const replay = await request(app).post('/auth/refresh').set(internal()).send({ refreshToken });
    expect(replay.status).toBe(401);

    // The legitimate newer token is now revoked too.
    const afterReplay = await request(app)
      .post('/auth/refresh')
      .set(internal())
      .send({ refreshToken: next });
    expect(afterReplay.status).toBe(401);
  });

  it('records consent changes and returns the profile', async () => {
    const res = await request(app)
      .patch('/auth/me/consents')
      .set(internalHeaders({ id: userId, role: 'consumer' }))
      .send({ openBanking: true });
    expect(res.status).toBe(200);
    expect(res.body.consents.openBanking).toBe(true);

    const audit = await db.adminPool.query(
      "SELECT count(*)::int AS n FROM credisync.regulatory_audit_logs WHERE user_id = $1 AND event_type = 'consent_granted'",
      [userId],
    );
    expect(audit.rows[0].n).toBe(1);
  });

  it('exports personal data without the SA ID', async () => {
    const res = await request(app)
      .get('/auth/me/export')
      .set(internalHeaders({ id: userId, role: 'consumer' }));
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(VALID_ID);
    expect(res.body.consentHistory.length).toBeGreaterThan(0);
  });

  it('locks the account after repeated failures without revealing it', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/auth/login')
        .set(internal())
        .send({ email: 'thandi@example.co.za', password: `nope-${i}-xxxxxx` });
    }
    const correctButLocked = await request(app)
      .post('/auth/login')
      .set(internal())
      .send({ email: 'thandi@example.co.za', password: 'correct-horse-battery' });
    expect(correctButLocked.status).toBe(401);

    const events = await db.adminPool.query(
      "SELECT count(*)::int AS n FROM credisync.regulatory_audit_logs WHERE user_id = $1 AND event_type = 'account_locked'",
      [userId],
    );
    expect(events.rows[0].n).toBe(1);
  });

  it('schedules erasure with a grace period', async () => {
    const res = await request(app)
      .post('/auth/me/deletion-request')
      .set(internalHeaders({ id: userId, role: 'consumer' }));
    expect(res.status).toBe(202);
    expect(new Date(res.body.scheduledFor).getTime()).toBeGreaterThan(Date.now());
  });
});
