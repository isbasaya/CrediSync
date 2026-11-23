import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
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
const ADMIN = '44444444-4444-4444-8444-444444444444';
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
        [ADMIN, 'ops@example.co.za', '7503035800088'],
      ] as const) {
        await c.query(
          `INSERT INTO credisync.users (id, email, mobile_number, first_name, last_name, sa_id_encrypted, sa_id_hash,
             popia_consent_granted, popia_consent_date, popia_policy_version, credit_check_consent, is_verified, role)
           VALUES ($1,$2,'+27820000000','Test','User',$3,$4,TRUE,NOW(),'test',TRUE,TRUE,$5)`,
          [
            id,
            email,
            await encryptToBytes(saId),
            hmacLookup(saId),
            id === ADMIN ? 'admin' : 'consumer',
          ],
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

  // The shared in-process limiter allows 100 requests a minute per IP. Each test starts a
  // fresh window by moving only the clock's Date a minute on (timers stay real).
  let clockOffsetMs = 0;
  afterEach(() => vi.useRealTimers());

  beforeEach(() => {
    clockOffsetMs += 61_000;
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + clockOffsetMs });
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

  const expireLink = (evidenceId: string) =>
    db.adminPool.query(
      "UPDATE credisync.dispute_evidence SET upload_url_expires_at = NOW() - interval '1 second' WHERE id = $1",
      [evidenceId],
    );
  const ageRow = (evidenceId: string, age: string) =>
    db.adminPool.query(
      'UPDATE credisync.dispute_evidence SET created_at = NOW() - $2::interval WHERE id = $1',
      [evidenceId, age],
    );

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
    // The upload link is still live, so the row stays as the handle on the object.
    expect(await statusOf(up.evidence.id)).toBe('deleting');
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

  it('keeps a file that never arrived pending, and retry issues a fresh link', async () => {
    const draftId = await newDraft();
    const res = await requestUpload(ALICE, draftId);
    const id = res.body.evidence.id;
    const done = await complete(ALICE, draftId, id);
    expect(done.status).toBe(409);
    expect(done.body.error).toBe('evidence_not_uploaded');
    expect(await statusOf(id)).toBe('pending');
    const submit = await request(app).post(`/disputes/${draftId}/submit`).set(as(ALICE));
    expect(submit.body.error).toBe('evidence_pending');

    const retry = await request(app)
      .post(`/disputes/${draftId}/evidence/${id}/retry`)
      .set(as(ALICE));
    expect(retry.status).toBe(200);
    expect(retry.body.evidence.id).toBe(id);
    expect(retry.body.uploadUrl).toContain(await keyOf(id));
    expect(retry.body.expiresIn).toBeGreaterThan(0);
    expect(retry.body.requiredHeaders).toBeTruthy();

    storage.put(await keyOf(id), PDF, 'application/pdf');
    expect((await complete(ALICE, draftId, id)).status).toBe(200);
  });

  it('retry is hidden from other users and refused for non-pending rows', async () => {
    const draftId = await newDraft();
    const up = await upload(ALICE, draftId, PDF, { complete: false });
    const url = `/disputes/${draftId}/evidence/${up.evidence.id}/retry`;
    expect((await request(app).post(url).set(as(MALLORY))).status).toBe(404);
    await complete(ALICE, draftId, up.evidence.id);
    const verified = await request(app).post(url).set(as(ALICE));
    expect(verified.status).toBe(409);
    expect(verified.body.error).toBe('not_pending');
  });

  it('re-putting through a live link after rejection leaves a deleting row to find it by', async () => {
    const draftId = await newDraft();
    const up = await upload(ALICE, draftId, SPOOF, { complete: false });
    const key = await keyOf(up.evidence.id);
    expect((await complete(ALICE, draftId, up.evidence.id)).status).toBe(400);
    expect(storage.has(key)).toBe(false);
    storage.put(key, SPOOF, 'application/pdf'); // replay of the still-valid link
    expect(await statusOf(up.evidence.id)).toBe('deleting');
    const rows = [{ id: up.evidence.id, storage_key: key }];
    await eraseMarked(db.pool, rows);
    expect(storage.has(key)).toBe(false);
    expect(await statusOf(up.evidence.id)).toBe('deleting');
  });

  it('fully removes a rejected row whose link has expired', async () => {
    const draftId = await newDraft();
    const up = await upload(ALICE, draftId, SPOOF, { complete: false });
    await expireLink(up.evidence.id);
    expect((await complete(ALICE, draftId, up.evidence.id)).status).toBe(400);
    expect(await statusOf(up.evidence.id)).toBeUndefined();
  });

  it('refuses retry and complete past 24 hours with 410 and erases the row', async () => {
    const draftId = await newDraft();
    const a = await upload(ALICE, draftId, PDF, { complete: false });
    await ageRow(a.evidence.id, '25 hours');
    await expireLink(a.evidence.id);
    const r = await request(app)
      .post(`/disputes/${draftId}/evidence/${a.evidence.id}/retry`)
      .set(as(ALICE));
    expect(r.status).toBe(410);
    expect(r.body.error).toBe('evidence_upload_expired');
    expect(r.body.message).toBe('This upload has expired. Please add the file again.');
    expect(await statusOf(a.evidence.id)).toBeUndefined();

    const b = await upload(ALICE, draftId, PDF, { complete: false });
    const key = await keyOf(b.evidence.id);
    await ageRow(b.evidence.id, '25 hours');
    await expireLink(b.evidence.id);
    const c = await complete(ALICE, draftId, b.evidence.id);
    expect(c.status).toBe(410);
    expect(c.body.error).toBe('evidence_upload_expired');
    expect(storage.has(key)).toBe(false);
    expect(await statusOf(b.evidence.id)).toBeUndefined();
  });

  it('caps a retry link at the time left in the 24-hour window', async () => {
    const draftId = await newDraft();
    const up = await upload(ALICE, draftId, PDF, { complete: false });
    await ageRow(up.evidence.id, '23 hours 55 minutes');
    await expireLink(up.evidence.id); // the first link has lapsed
    const r = await request(app)
      .post(`/disputes/${draftId}/evidence/${up.evidence.id}/retry`)
      .set(as(ALICE));
    expect(r.status).toBe(200);
    expect(r.body.expiresIn).toBeLessThanOrEqual(300);
    expect(r.body.expiresIn).toBeGreaterThan(0);
    const stored = await db.adminPool.query(
      "SELECT upload_url_expires_at <= created_at + interval '24 hours' + interval '2 seconds' AS ok FROM credisync.dispute_evidence WHERE id = $1",
      [up.evidence.id],
    );
    expect(stored.rows[0].ok).toBe(true);
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
    expect(await statusOf(up.evidence.id)).toBe('deleting'); // link still live
    await expireLink(up.evidence.id);
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
    await expireLink(a.evidence.id);
    await expireLink(b.evidence.id);
    await eraseMarked(db.pool, rows);
    expect(await statusOf(a.evidence.id)).toBeUndefined();
    expect(await statusOf(b.evidence.id)).toBeUndefined();
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
    expect(await statusOf(up.evidence.id)).toBe('deleting');
  });

  it('refuses new uploads once the dispute was sent', async () => {
    const draftId = await newDraft();
    await request(app).post(`/disputes/${draftId}/submit`).set(as(ALICE));
    const res = await requestUpload(ALICE, draftId);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('not_editable');
  });

  // --- Task 3: downloads and deletion ---------------------------------------

  const remove = (user: string, disputeId: string, evidenceId: string) =>
    request(app).delete(`/disputes/${disputeId}/evidence/${evidenceId}`).set(as(user));
  const download = (user: string, disputeId: string, evidenceId: string) =>
    request(app).get(`/disputes/${disputeId}/evidence/${evidenceId}/download-url`).set(as(user));
  const adminDownload = (headers: Record<string, string>, disputeId: string, evidenceId: string) =>
    request(app)
      .get(`/admin/disputes/${disputeId}/evidence/${evidenceId}/download-url`)
      .set(headers);
  const auditFor = (evidenceId: string, eventType: string) =>
    db.adminPool.query(
      "SELECT performed_by, payload FROM credisync.regulatory_audit_logs WHERE event_type = $1 AND payload->>'evidence_id' = $2",
      [eventType, evidenceId],
    );

  it('removing evidence erases the file and updates the letter', async () => {
    const draftId = await newDraft();
    const up = await upload(ALICE, draftId, PDF);
    const key = await keyOf(up.evidence.id);
    expect(up.done.body.letterContent).toContain(WORDING);
    const res = await remove(ALICE, draftId, up.evidence.id);
    expect(res.status).toBe(200);
    expect(res.body.letterContent).not.toContain(WORDING);
    expect(res.body.evidence).toEqual([]);
    expect(res.body.letterVersion).toBe(up.done.body.letterVersion + 1);
    expect(storage.has(key)).toBe(false);
    // The upload link may still be live: the row stays deleting and is never exposed.
    expect(await statusOf(up.evidence.id)).toBe('deleting');
    expect((await get(ALICE, draftId)).body.evidence).toEqual([]);
    await expireLink(up.evidence.id);
    await eraseMarked(db.pool, [{ id: up.evidence.id, storage_key: key }]);
    expect(await statusOf(up.evidence.id)).toBeUndefined();
  });

  it('deleting rows do not count toward the 10-file limit', async () => {
    const draftId = await newDraft();
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) ids.push((await upload(ALICE, draftId, PDF)).evidence.id);
    expect((await requestUpload(ALICE, draftId)).status).toBe(409);
    expect((await remove(ALICE, draftId, ids[0]!)).status).toBe(200);
    expect((await requestUpload(ALICE, draftId)).status).toBe(201);
  });

  it('cannot remove evidence once sent', async () => {
    const draftId = await newDraft();
    const up = await upload(ALICE, draftId, PDF);
    const key = await keyOf(up.evidence.id);
    await request(app).post(`/disputes/${draftId}/submit`).set(as(ALICE));
    const res = await remove(ALICE, draftId, up.evidence.id);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('not_editable');
    expect(storage.has(key)).toBe(true);
    expect(await statusOf(up.evidence.id)).toBe('verified');
  });

  it('hides removal from other users and unknown files', async () => {
    const draftId = await newDraft();
    const up = await upload(ALICE, draftId, PDF);
    expect((await remove(MALLORY, draftId, up.evidence.id)).status).toBe(404);
    expect((await remove(ALICE, draftId, randomUUID())).status).toBe(404);
    expect((await remove(ALICE, draftId, 'nope')).status).toBe(404);
    expect(await statusOf(up.evidence.id)).toBe('verified');
  });

  it('a storage failure leaves the row deleting and the API succeeds', async () => {
    const draftId = await newDraft();
    const up = await upload(ALICE, draftId, PDF);
    const key = await keyOf(up.evidence.id);
    storage.failDeletes = true;
    const res = await remove(ALICE, draftId, up.evidence.id);
    expect(res.status).toBe(200);
    expect(await statusOf(up.evidence.id)).toBe('deleting');
    expect(storage.has(key)).toBe(true);
  });

  it('deleting a draft queues and erases its files', async () => {
    const draftId = await newDraft();
    const a = await upload(ALICE, draftId, PDF);
    const b = await upload(ALICE, draftId, PDF, { complete: false });
    const keys = [await keyOf(a.evidence.id), await keyOf(b.evidence.id)];
    const res = await request(app).delete(`/disputes/${draftId}`).set(as(ALICE));
    expect(res.status).toBe(204);
    for (const k of keys) expect(storage.has(k)).toBe(false);
    expect(await statusOf(a.evidence.id)).toBe('deleting');
    await expireLink(a.evidence.id);
    await expireLink(b.evidence.id);
    await eraseMarked(
      db.pool,
      [a, b].map((x, i) => ({ id: x.evidence.id, storage_key: keys[i]! })),
    );
    expect(await statusOf(a.evidence.id)).toBeUndefined();
  });

  it('a failed erase after draft delete survives for retry', async () => {
    const draftId = await newDraft();
    const up = await upload(ALICE, draftId, PDF);
    const key = await keyOf(up.evidence.id);
    storage.failDeletes = true;
    const res = await request(app).delete(`/disputes/${draftId}`).set(as(ALICE));
    expect(res.status).toBe(204);
    const row = await db.adminPool.query(
      'SELECT status, dispute_id FROM credisync.dispute_evidence WHERE id = $1',
      [up.evidence.id],
    );
    expect(row.rows[0]).toEqual({ status: 'deleting', dispute_id: null });
    expect(storage.has(key)).toBe(true);
  });

  it('deleting a sent dispute is refused and keeps its evidence', async () => {
    const draftId = await newDraft();
    const up = await upload(ALICE, draftId, PDF);
    await request(app).post(`/disputes/${draftId}/submit`).set(as(ALICE));
    const res = await request(app).delete(`/disputes/${draftId}`).set(as(ALICE));
    expect(res.status).toBe(409);
    expect(await statusOf(up.evidence.id)).toBe('verified');
    expect((await request(app).delete(`/disputes/${randomUUID()}`).set(as(ALICE))).status).toBe(
      404,
    );
  });

  it('consumer download is owner-only and audited as data_access', async () => {
    const draftId = await newDraft();
    const up = await upload(ALICE, draftId, PDF);
    expect((await download(MALLORY, draftId, up.evidence.id)).status).toBe(404);
    const res = await download(ALICE, draftId, up.evidence.id);
    expect(res.status).toBe(200);
    expect(res.body.expiresIn).toBe(300);
    expect(res.body.url).toContain(await keyOf(up.evidence.id));
    const audit = await auditFor(up.evidence.id, 'data_access');
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].payload).toEqual({
      action: 'download_evidence',
      evidence_id: up.evidence.id,
    });
  });

  it('staff download requires an ops role, a sent dispute and is audited', async () => {
    const draftId = await newDraft();
    const up = await upload(ALICE, draftId, PDF);
    const ops = internalHeaders({ id: ADMIN, role: 'admin' });
    expect((await adminDownload(as(ALICE), draftId, up.evidence.id)).status).toBe(403);
    const draft = await adminDownload(ops, draftId, up.evidence.id);
    expect(draft.status).toBe(409);
    expect(draft.body.error).toBe('not_submitted');
    await request(app).post(`/disputes/${draftId}/submit`).set(as(ALICE));
    const res = await adminDownload(ops, draftId, up.evidence.id);
    expect(res.status).toBe(200);
    expect(res.body.expiresIn).toBe(300);
    expect(res.body.url).toBeTruthy();
    const audit = await auditFor(up.evidence.id, 'admin_access');
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].performed_by).toBe(ADMIN);
    expect(audit.rows[0].payload).toEqual({
      action: 'download_evidence',
      evidence_id: up.evidence.id,
    });
    expect((await adminDownload(ops, draftId, randomUUID())).status).toBe(404);
  });

  it('download refuses pending or deleting files', async () => {
    const draftId = await newDraft();
    const pending = await upload(ALICE, draftId, PDF, { complete: false });
    expect((await download(ALICE, draftId, pending.evidence.id)).status).toBe(404);
    const gone = await upload(ALICE, draftId, PDF);
    await remove(ALICE, draftId, gone.evidence.id);
    expect((await download(ALICE, draftId, gone.evidence.id)).status).toBe(404);
    expect((await auditFor(gone.evidence.id, 'data_access')).rows).toHaveLength(0);

    const sentDraft = await newDraft();
    const p2 = await upload(ALICE, sentDraft, PDF, { complete: false });
    await db.adminPool.query("UPDATE credisync.disputes SET status = 'submitted' WHERE id = $1", [
      sentDraft,
    ]);
    const ops = internalHeaders({ id: ADMIN, role: 'admin' });
    expect((await adminDownload(ops, sentDraft, p2.evidence.id)).status).toBe(404);
  });

  it('deletion audit uses delete_evidence with no key or filename', async () => {
    const draftId = await newDraft();
    const up = await upload(ALICE, draftId, PDF);
    const key = await keyOf(up.evidence.id);
    await remove(ALICE, draftId, up.evidence.id);
    const audit = await auditFor(up.evidence.id, 'data_deletion_completed');
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].payload).toEqual({
      action: 'delete_evidence',
      evidence_id: up.evidence.id,
    });
    expect(JSON.stringify(audit.rows[0].payload)).not.toContain(key);
  });
});
