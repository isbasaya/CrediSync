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
import { SandboxOpenBankingAdapter } from '../adapters/sandbox.adapter';

const ALICE = '11111111-1111-4111-8111-111111111111';
const MALLORY = '33333333-3333-4333-8333-333333333333';

describe.skipIf(!testDatabaseAvailable)('open banking (real Postgres, sandbox provider)', () => {
  let db: TestDatabase;
  let app: ReturnType<typeof createApp>;
  let linkId: string;
  const as = (id: string) => internalHeaders({ id, role: 'consumer' });

  beforeAll(async () => {
    db = await createTestDatabase();
    app = createApp(db.pool, {
      stitch: new SandboxOpenBankingAdapter('stitch'),
      ozow: new SandboxOpenBankingAdapter('ozow'),
    });
    await withSystem(db.pool, async (c) => {
      for (const [id, email, saId, consent] of [
        [ALICE, 'alice@example.co.za', '8001015009087', false],
        [MALLORY, 'mallory@example.co.za', '9202204720083', true],
      ] as const) {
        await c.query(
          `INSERT INTO credisync.users (id, email, mobile_number, first_name, last_name, sa_id_encrypted, sa_id_hash,
             popia_consent_granted, popia_consent_date, popia_policy_version, open_banking_consent, is_verified)
           VALUES ($1,$2,'+27820000000','T','U',$3,$4,TRUE,NOW(),'test',$5,TRUE)`,
          [id, email, await encryptToBytes(saId), hmacLookup(saId), consent],
        );
      }
    });
  }, 60_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('refuses to link a bank account without open-banking consent', async () => {
    const res = await request(app)
      .post('/links')
      .set(as(ALICE))
      .send({ source: 'stitch', accountLinkToken: 'tok_abcdefgh' });
    expect(res.status).toBe(403);
  });

  it('links after consent and never returns the provider token', async () => {
    await withSystem(db.pool, (c) =>
      c.query('UPDATE credisync.users SET open_banking_consent = TRUE WHERE id = $1', [ALICE]),
    );
    const res = await request(app)
      .post('/links')
      .set(as(ALICE))
      .send({ source: 'stitch', accountLinkToken: 'tok_abcdefgh_secret' });
    expect(res.status).toBe(201);
    expect(JSON.stringify(res.body)).not.toContain('tok_abcdefgh_secret');
    linkId = res.body.id;

    const stored = await db.adminPool.query(
      'SELECT token_encrypted FROM credisync.open_banking_links WHERE id = $1',
      [linkId],
    );
    expect(Buffer.from(stored.rows[0].token_encrypted).toString()).not.toContain(
      'tok_abcdefgh_secret',
    );
  });

  it("cannot ingest through someone else's link", async () => {
    const res = await request(app)
      .post('/snapshots/ingest')
      .set(as(MALLORY))
      .send({ linkId, periodStart: '2026-07-01', periodEnd: '2026-08-31' });
    expect(res.status).toBe(404);
  });

  it('ingests monthly figures and skips duplicates on overlapping periods', async () => {
    const first = await request(app)
      .post('/snapshots/ingest')
      .set(as(ALICE))
      .send({ linkId, periodStart: '2026-07-01', periodEnd: '2026-08-31' });
    expect(first.status).toBe(201);
    expect(first.body.monthlyNetIncome).toBeGreaterThan(20000);
    expect(first.body.monthlyNetIncome).toBeLessThan(30000);
    expect(first.body.transactionsStored).toBeGreaterThan(0);

    const overlap = await request(app)
      .post('/snapshots/ingest')
      .set(as(ALICE))
      .send({ linkId, periodStart: '2026-08-01', periodEnd: '2026-08-31' });
    expect(overlap.status).toBe(201);
    expect(overlap.body.transactionsStored).toBe(0);
  });

  it('stops ingesting once the link is revoked', async () => {
    expect((await request(app).delete(`/links/${linkId}`).set(as(ALICE))).status).toBe(204);
    const res = await request(app)
      .post('/snapshots/ingest')
      .set(as(ALICE))
      .send({ linkId, periodStart: '2026-08-01', periodEnd: '2026-08-31' });
    expect(res.status).toBe(409);
  });
});
