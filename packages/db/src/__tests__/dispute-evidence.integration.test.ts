import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import {
  createTestDatabase,
  testDatabaseAvailable,
  withSystem,
  withUser,
  type TestDatabase,
} from '../index';

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';

describe.skipIf(!testDatabaseAvailable)('dispute_evidence schema (real Postgres)', () => {
  let db: TestDatabase;
  let disputeId: string;

  const insert = (
    c: { query: (q: string, v: unknown[]) => Promise<unknown> },
    over: Record<string, unknown> = {},
  ) => {
    const v = {
      user_id: ALICE,
      dispute_id: null,
      storage_key: `uploads/${ALICE}/${randomUUID()}.pdf`,
      content_type: 'application/pdf',
      size_bytes: 10,
      display_name: 'proof.pdf',
      ...over,
    };
    return c.query(
      `INSERT INTO credisync.dispute_evidence (user_id, dispute_id, storage_key, content_type, size_bytes, display_name, upload_url_expires_at)
       VALUES ($1,$2,$3,$4,$5,$6, NOW() + interval '15 minutes')`,
      [v.user_id, v.dispute_id, v.storage_key, v.content_type, v.size_bytes, v.display_name],
    );
  };

  beforeAll(async () => {
    db = await createTestDatabase();
    await withSystem(db.pool, async (c) => {
      for (const [id, n] of [
        [ALICE, 'a'],
        [BOB, 'b'],
      ] as const) {
        await c.query(
          `INSERT INTO credisync.users (id, email, mobile_number, first_name, last_name, sa_id_encrypted, sa_id_hash)
           VALUES ($1, $2, $3, 'A', 'L', decode('00','hex'), $4)`,
          [id, `${n}@example.co.za`, `+2782000000${n === 'a' ? 0 : 1}`, `hash-${n}`],
        );
      }
      const cp = await c.query<{ id: string }>(
        'INSERT INTO credisync.credit_profiles (user_id) VALUES ($1) RETURNING id',
        [ALICE],
      );
      const ba = await c.query<{ id: string }>(
        `INSERT INTO credisync.bureau_accounts (credit_profile_id, user_id, bureau, account_reference, creditor_name, account_type, status, resolved_account_id)
         VALUES ($1, $2, 'xds', 'R1', 'Edcon', 'retail', 'default', $3) RETURNING id`,
        [cp.rows[0]!.id, ALICE, randomUUID()],
      );
      const d = await c.query<{ id: string; letter_has_evidence: boolean }>(
        `INSERT INTO credisync.disputes (user_id, bureau_account_id, bureau, dispute_reason, dispute_description)
         VALUES ($1, $2, 'xds', 'incorrect_balance', 'Balance is wrong per statement') RETURNING id, letter_has_evidence`,
        [ALICE, ba.rows[0]!.id],
      );
      disputeId = d.rows[0]!.id;
      expect(d.rows[0]!.letter_has_evidence).toBe(false);
    });
  }, 60_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('enforces the column checks', async () => {
    await expect(
      withUser(db.pool, ALICE, (c) => insert(c, { content_type: 'text/html' })),
    ).rejects.toThrow(/content_type/);
    await expect(withUser(db.pool, ALICE, (c) => insert(c, { size_bytes: 0 }))).rejects.toThrow(
      /size_bytes/,
    );
    await expect(
      withUser(db.pool, ALICE, (c) => insert(c, { display_name: 'x'.repeat(121) })),
    ).rejects.toThrow(/display_name/);
  });

  it('isolates rows by user through RLS', async () => {
    await withUser(db.pool, ALICE, (c) => insert(c, { dispute_id: disputeId }));
    await expect(withUser(db.pool, BOB, (c) => insert(c, { user_id: ALICE }))).rejects.toThrow(
      /row-level security/,
    );
    const mine = await withUser(db.pool, ALICE, (c) =>
      c.query('SELECT status FROM credisync.dispute_evidence'),
    );
    expect(mine.rows).toEqual([{ status: 'pending' }]);
    const theirs = await withUser(db.pool, BOB, (c) =>
      c.query('SELECT 1 FROM credisync.dispute_evidence'),
    );
    expect(theirs.rowCount).toBe(0);
  });

  it('keeps the row when its dispute is deleted', async () => {
    await withSystem(db.pool, (c) =>
      c.query('DELETE FROM credisync.disputes WHERE id = $1', [disputeId]),
    );
    const r = await withUser(db.pool, ALICE, (c) =>
      c.query('SELECT dispute_id FROM credisync.dispute_evidence'),
    );
    expect(r.rows).toEqual([{ dispute_id: null }]);
  });
});
