import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import {
  createTestDatabase,
  testDatabaseAvailable,
  withSystem,
  type TestDatabase,
} from '@credisync/db';
import { encryptToBytes, hmacLookup } from '@credisync/crypto';
import { internalHeaders } from '@credisync/middleware';
import { createApp } from '../app';
import { SandboxBureauAdapter } from '../adapters/sandbox.adapter';

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';

async function seedUser(
  db: TestDatabase,
  id: string,
  opts: { verified: boolean; consent: boolean; saId: string; email: string },
) {
  await withSystem(db.pool, async (c) => {
    await c.query(
      `INSERT INTO credisync.users (id, email, mobile_number, first_name, last_name, sa_id_encrypted, sa_id_hash,
         popia_consent_granted, popia_consent_date, popia_policy_version, credit_check_consent, is_verified)
       VALUES ($1,$2,'+27820000000','Test','User',$3,$4,TRUE,NOW(),'test',$5,$6)`,
      [
        id,
        opts.email,
        await encryptToBytes(opts.saId),
        hmacLookup(opts.saId),
        opts.consent,
        opts.verified,
      ],
    );
  });
}

describe.skipIf(!testDatabaseAvailable)('bureau refresh (real Postgres, sandbox bureaus)', () => {
  let db: TestDatabase;
  let app: ReturnType<typeof createApp>;
  const as = (id: string) => internalHeaders({ id, role: 'consumer' });

  beforeAll(async () => {
    db = await createTestDatabase();
    app = createApp(
      db.pool,
      (['transunion', 'experian', 'xds'] as const).map((b) => new SandboxBureauAdapter(b)),
    );
    await seedUser(db, ALICE, {
      verified: true,
      consent: true,
      saId: '8001015009087',
      email: 'alice@example.co.za',
    });
    await seedUser(db, BOB, {
      verified: true,
      consent: false,
      saId: '9202204720083',
      email: 'bob@example.co.za',
    });
  }, 60_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('requires the gateway token and an acting user', async () => {
    expect((await request(app).get('/credit-profile')).status).toBe(401);
    expect((await request(app).get('/credit-profile').set(internalHeaders())).status).toBe(401);
  });

  it('refuses to pull reports without credit-check consent', async () => {
    const res = await request(app).post('/credit-profile/refresh').set(as(BOB));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('credit_check_consent_required');
  });

  it('refreshes, merges cross-bureau duplicates and serves the profile', async () => {
    const res = await request(app).post('/credit-profile/refresh').set(as(ALICE));
    expect(res.status).toBe(200);
    expect(res.body.profile.totalAccounts).toBe(3); // 9 bureau records → 3 real facilities
    expect(res.body.profile.bureauScores).toHaveLength(3);

    const accounts = await request(app).get('/credit-profile/accounts').set(as(ALICE));
    expect(accounts.status).toBe(200);
    expect(accounts.body).toHaveLength(3);
    expect(accounts.body[0].reportedBy).toHaveLength(3);
  });

  it('enforces the refresh cooldown', async () => {
    const res = await request(app).post('/credit-profile/refresh').set(as(ALICE));
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
  });

  it("never shows one user another user's data (row-level security)", async () => {
    const profile = await request(app).get('/credit-profile').set(as(BOB));
    expect(profile.status).toBe(404);
    const accounts = await request(app).get('/credit-profile/accounts').set(as(BOB));
    expect(accounts.body).toEqual([]);
  });

  it('records bureau pulls in the audit log', async () => {
    const r = await db.adminPool.query(
      "SELECT count(*)::int AS n FROM credisync.regulatory_audit_logs WHERE user_id = $1 AND event_type = 'bureau_pull'",
      [ALICE],
    );
    expect(r.rows[0].n).toBe(3);
  });
});
