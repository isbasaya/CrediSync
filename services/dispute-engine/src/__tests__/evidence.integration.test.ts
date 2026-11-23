import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import {
  createTestDatabase,
  testDatabaseAvailable,
  withSystem,
  type TestDatabase,
} from '@credisync/db';
import { encryptToBytes, hmacLookup } from '@credisync/crypto';
import { internalHeaders } from '@credisync/middleware';
import { InMemoryStorageProvider, setStorageProvider } from '@credisync/storage';
import { createApp } from '../app';
import { eraseMarked, markEvidenceDeleting } from '../evidence';

const ALICE = '11111111-1111-4111-8111-111111111111';
const MALLORY = '33333333-3333-4333-8333-333333333333';
const PDF = Buffer.from('%PDF-1.4 test body');
const SPOOF = Buffer.from([0x4d, 0x5a, 0x90, 0x00]);
const WORDING = 'Supporting evidence is attached';

describe.skipIf(!testDatabaseAvailable)('dispute evidence (real Postgres)', () => {
  let db: TestDatabase;
  let app: ReturnType<typeof createApp>;
  let storage: InMemoryStorageProvider;
  let profileId: string;
  const as = (id: string) => internalHeaders({ id, role: 'consumer' });

  beforeAll(async () => {
    db = await createTestDatabase();
    app = createApp(db.pool);
    await withSystem(db.pool, async (c) => {
      for (const [id, email, saId] of [
        [ALICE, 'alice@example.co.za', '8001015009087'],
        [MALLORY, 'mallory@example.co.za', '9202204720083'],
      ] as const) {
        await c.query(
          `INSERT INTO credisync.users (id, email, mobile_number, first_name, last_name, sa_id_encrypted, sa_id_hash,
             popia_consent_granted, popia_consent_date, popia_policy_version, credit_check_consent, is_verified, role)
           VALUES ($1,$2,'+27820000000','Test','User',$3,$4,TRUE,NOW(),'test',TRUE,TRUE,'consumer')`,
          [id, email, await encryptToBytes(saId), hmacLookup(saId)],
        );
      }
      profileId = (
        await c.query<{ id: string }>(
          'INSERT INTO credisync.credit_profiles (user_id) VALUES ($1) RETURNING id',
          [ALICE],
        )
      ).rows[0]!.id;
    });
  }, 60_000);

  afterAll(async () => {
    setStorageProvider(null);
    await db?.drop();
  });

  beforeEach(() => {
    storage = new InMemoryStorageProvider();
    setStorageProvider(storage);
  });

  let n = 0;
  async function newDraft(): Promise<string> {
    n += 1;
    const account = await withSystem(
      db.pool,
      async (c) =>
        (
          await c.query<{ id: string }>(
            `INSERT INTO credisync.bureau_accounts (credit_profile_id, user_id, bureau, account_reference, creditor_name, account_type,
             status, current_balance, overdue_amount, resolved_account_id, is_cluster_primary)
           VALUES ($1, $2, 'experian', $3, 'Edcon Retail', 'retail', 'default', 100, 100, $4, TRUE) RETURNING id`,
            [profileId, ALICE, `EX-EV-${n}`, randomUUID()],
          )
        ).rows[0]!.id,
    );
    const res = await request(app).post('/disputes').set(as(ALICE)).send({
      bureauAccountId: account,
      reason: 'settled_in_full_not_updated',
      description: 'I settled this account in full in March 2024.',
    });
    expect(res.status).toBe(201);
    return res.body.id;
  }

  const requestUpload = (user: string, disputeId: string, body: object = {}) =>
    request(app)
      .post(`/disputes/${disputeId}/evidence`)
      .set(as(user))
      .send({ contentType: 'application/pdf', contentLength: 100, fileName: 'proof.pdf', ...body });
  const complete = (user: string, disputeId: string, evidenceId: string) =>
    request(app).post(`/disputes/${disputeId}/evidence/${evidenceId}/complete`).set(as(user));
  const get = (user: string, disputeId: string) =>
    request(app).get(`/disputes/${disputeId}`).set(as(user));
  const keyOf = async (evidenceId: string) =>
    (
      await db.adminPool.query<{ storage_key: string }>(
        'SELECT storage_key FROM credisync.dispute_evidence WHERE id = $1',
        [evidenceId],
      )
    ).rows[0]!.storage_key;
  const statusOf = async (evidenceId: string) =>
    (
      await db.adminPool.query<{ status: string }>(
        'SELECT status FROM credisync.dispute_evidence WHERE id = $1',
        [evidenceId],
      )
    ).rows[0]?.status;

  async function upload(
    user: string,
    disputeId: string,
    bytes: Buffer,
    opts: { complete?: boolean } = {},
  ) {
    const res = await requestUpload(user, disputeId, {
      contentLength: bytes.length,
      contentType: 'application/pdf',
    });
    expect(res.status).toBe(201);
    storage.put(await keyOf(res.body.evidence.id), bytes, 'application/pdf');
    if (opts.complete !== false) {
      const done = await complete(user, disputeId, res.body.evidence.id);
      return { ...res.body, done };
    }
    return res.body;
  }

  it('adds evidence wording only after verification', async () => {
    const draftId = await newDraft();
    const up = await upload(ALICE, draftId, PDF, { complete: false });
    expect(up.uploadUrl).toBeTruthy();
    expect(up.expiresIn).toBeGreaterThan(0);
    expect((await get(ALICE, draftId)).body.letterContent).not.toContain(WORDING);
    const done = await complete(ALICE, draftId, up.evidence.id);
    expect(done.status).toBe(200);
    expect(done.body.letterContent).toContain(WORDING);
    expect(done.body.evidence).toHaveLength(1);
    expect(done.body.evidence[0]).toMatchObject({ displayName: 'proof.pdf', status: 'verified' });
    expect(JSON.stringify(done.body)).not.toContain('uploads/');
    expect(JSON.stringify(up.evidence)).not.toContain(await keyOf(up.evidence.id));
  });

  it('completing twice succeeds and bumps the letter once', async () => {
    const draftId = await newDraft();
    const before = (await get(ALICE, draftId)).body.letterVersion;
    const up = await upload(ALICE, draftId, PDF, { complete: false });
    const results = await Promise.all([
      complete(ALICE, draftId, up.evidence.id),
      complete(ALICE, draftId, up.evidence.id),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect((await get(ALICE, draftId)).body.letterVersion).toBe(before + 1);
    const again = await complete(ALICE, draftId, up.evidence.id);
    expect(again.status).toBe(200);
    expect(again.body.letterVersion).toBe(before + 1);
  });

  it('rejects and erases a spoofed file', async () => {
    const draftId = await newDraft();
    const up = await upload(ALICE, draftId, SPOOF, { complete: false });
    const key = await keyOf(up.evidence.id);
    const res = await complete(ALICE, draftId, up.evidence.id);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_evidence');
    expect(res.body.message).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toContain('uploads/');
    expect(storage.has(key)).toBe(false);
    expect(await statusOf(up.evidence.id)).toBeUndefined();
    const audit = await db.adminPool.query(
      "SELECT payload FROM credisync.regulatory_audit_logs WHERE event_type = 'data_deletion_completed' AND payload->>'evidence_id' = $1",
      [up.evidence.id],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].payload).toEqual({
      action: 'delete_evidence',
      evidence_id: up.evidence.id,
    });
  });

  it('rejects a file that never arrived', async () => {
    const draftId = await newDraft();
    const res = await requestUpload(ALICE, draftId);
    const done = await complete(ALICE, draftId, res.body.evidence.id);
    expect(done.status).toBe(400);
    expect(done.body.error).toBe('invalid_evidence');
  });

  it('keeps a failed erase as deleting so it can be retried', async () => {
    const draftId = await newDraft();
    const up = await upload(ALICE, draftId, SPOOF, { complete: false });
    storage.failDeletes = true;
    const res = await complete(ALICE, draftId, up.evidence.id);
    expect(res.status).toBe(400);
    expect(await statusOf(up.evidence.id)).toBe('deleting');
    storage.failDeletes = false;
    const rows = await db.adminPool.query<{ id: string; storage_key: string }>(
      "SELECT id, storage_key FROM credisync.dispute_evidence WHERE id = $1 AND status = 'deleting'",
      [up.evidence.id],
    );
    await eraseMarked(db.pool, rows.rows);
    expect(await statusOf(up.evidence.id)).toBeUndefined();
  });

  it('markEvidenceDeleting queues rows once and audits only the queueing', async () => {
    const draftId = await newDraft();
    const a = await upload(ALICE, draftId, PDF);
    const b = await upload(ALICE, draftId, PDF, { complete: false });
    const rows = await withSystem(db.pool, (c) => markEvidenceDeleting(c, { disputeId: draftId }));
    expect(rows.map((r) => r.id).sort()).toEqual([a.evidence.id, b.evidence.id].sort());
    const again = await withSystem(db.pool, (c) => markEvidenceDeleting(c, { disputeId: draftId }));
    expect(again).toEqual([]);
    const audit = await db.adminPool.query(
      "SELECT 1 FROM credisync.regulatory_audit_logs WHERE event_type = 'data_deletion_completed' AND payload->>'action' = 'delete_evidence' AND payload->>'evidence_id' = ANY($1)",
      [[a.evidence.id, b.evidence.id]],
    );
    expect(audit.rowCount).toBe(2);
    await eraseMarked(db.pool, rows);
    expect(await statusOf(a.evidence.id)).toBeUndefined();
  });

  it('blocks sending with a pending upload, then allows it once resolved', async () => {
    const otherDraft = await newDraft();
    const up = await upload(ALICE, otherDraft, PDF, { complete: false });
    const res = await request(app).post(`/disputes/${otherDraft}/submit`).set(as(ALICE));
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('evidence_pending');
    await complete(ALICE, otherDraft, up.evidence.id);
    const ok = await request(app).post(`/disputes/${otherDraft}/submit`).set(as(ALICE));
    expect(ok.status).toBe(200);
    expect(ok.body.letterContent).toContain(WORDING);
    expect(ok.body.evidence).toHaveLength(1);
  });

  it('syncs the letter on read and on submit when verified files were removed', async () => {
    const draftId = await newDraft();
    const up = await upload(ALICE, draftId, PDF);
    expect(up.done.body.letterContent).toContain(WORDING);
    await db.adminPool.query('DELETE FROM credisync.dispute_evidence WHERE id = $1', [
      up.evidence.id,
    ]);
    const read = await get(ALICE, draftId);
    expect(read.body.letterContent).not.toContain(WORDING);
    expect(read.body.letterVersion).toBe(up.done.body.letterVersion + 1);
    expect((await get(ALICE, draftId)).body.letterVersion).toBe(read.body.letterVersion);

    const draft2 = await newDraft();
    const up2 = await upload(ALICE, draft2, PDF);
    await db.adminPool.query('DELETE FROM credisync.dispute_evidence WHERE id = $1', [
      up2.evidence.id,
    ]);
    const sent = await request(app).post(`/disputes/${draft2}/submit`).set(as(ALICE));
    expect(sent.status).toBe(200);
    expect(sent.body.letterContent).not.toContain(WORDING);
  });

  it('enforces 10 files under concurrency', async () => {
    const limitDraft = await newDraft();
    const results = await Promise.all(
      Array.from({ length: 15 }, () => requestUpload(ALICE, limitDraft)),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(10);
    const refused = results.filter((r) => r.status === 409);
    expect(refused).toHaveLength(5);
    expect(refused[0]!.body.error).toBe('evidence_limit');
  });

  it('validates the upload request', async () => {
    const draftId = await newDraft();
    expect((await requestUpload(ALICE, draftId, { contentType: 'text/html' })).status).toBe(400);
    expect((await requestUpload(ALICE, draftId, { contentLength: 11 * 1024 * 1024 })).status).toBe(
      400,
    );
  });

  it("hides another user's dispute", async () => {
    const draftId = await newDraft();
    const up = await upload(ALICE, draftId, PDF, { complete: false });
    expect((await requestUpload(MALLORY, draftId)).status).toBe(404);
    expect((await complete(MALLORY, draftId, up.evidence.id)).status).toBe(404);
    expect(await statusOf(up.evidence.id)).toBe('pending');
  });

  it('refuses to complete after the dispute was sent, and queues the file', async () => {
    const racedDraft = await newDraft();
    const up = await upload(ALICE, racedDraft, PDF, { complete: false });
    const key = await keyOf(up.evidence.id);
    await db.adminPool.query("UPDATE credisync.disputes SET status = 'submitted' WHERE id = $1", [
      racedDraft,
    ]);
    expect((await complete(ALICE, racedDraft, up.evidence.id)).status).toBe(409);
    expect(storage.has(key)).toBe(false);
    expect(await statusOf(up.evidence.id)).toBeUndefined();
  });

  it('refuses new uploads once the dispute was sent', async () => {
    const draftId = await newDraft();
    await request(app).post(`/disputes/${draftId}/submit`).set(as(ALICE));
    const res = await requestUpload(ALICE, draftId);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('not_editable');
  });
});
