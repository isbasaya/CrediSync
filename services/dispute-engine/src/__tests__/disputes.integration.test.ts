import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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
import { createApp } from '../app';
import { signWebhook, webhookSecret } from '../webhook-signature';

const ALICE = '11111111-1111-4111-8111-111111111111';
const MALLORY = '33333333-3333-4333-8333-333333333333';
const ADMIN = '44444444-4444-4444-8444-444444444444';

async function seed(db: TestDatabase) {
  let aliceAccount = '';
  await withSystem(db.pool, async (c) => {
    const users: Array<[string, string, string, string]> = [
      [ALICE, 'alice@example.co.za', '8001015009087', 'consumer'],
      [MALLORY, 'mallory@example.co.za', '9202204720083', 'consumer'],
      [ADMIN, 'ops@example.co.za', '7503035800088', 'admin'],
    ];
    for (const [id, email, saId, role] of users) {
      await c.query(
        `INSERT INTO credisync.users (id, email, mobile_number, first_name, last_name, sa_id_encrypted, sa_id_hash,
           popia_consent_granted, popia_consent_date, popia_policy_version, credit_check_consent, is_verified, role)
         VALUES ($1,$2,'+27820000000','Test','User',$3,$4,TRUE,NOW(),'test',TRUE,TRUE,$5)`,
        [id, email, await encryptToBytes(saId), hmacLookup(saId), role],
      );
    }
    const profile = await c.query<{ id: string }>(
      'INSERT INTO credisync.credit_profiles (user_id) VALUES ($1) RETURNING id',
      [ALICE],
    );
    const account = await c.query<{ id: string }>(
      `INSERT INTO credisync.bureau_accounts (credit_profile_id, user_id, bureau, account_reference, creditor_name, account_type,
         status, current_balance, overdue_amount, resolved_account_id, is_cluster_primary)
       VALUES ($1, $2, 'experian', 'EX-RT-1', 'Edcon Retail', 'retail', 'default', 6420, 6420, $3, TRUE) RETURNING id`,
      [profile.rows[0]!.id, ALICE, randomUUID()],
    );
    aliceAccount = account.rows[0]!.id;
  });
  return aliceAccount;
}

describe.skipIf(!testDatabaseAvailable)('dispute engine (real Postgres)', () => {
  let db: TestDatabase;
  let app: ReturnType<typeof createApp>;
  let accountId: string;
  let disputeId: string;
  const as = (id: string, role = 'consumer') => internalHeaders({ id, role });

  beforeAll(async () => {
    db = await createTestDatabase();
    app = createApp(db.pool);
    accountId = await seed(db);
  }, 60_000);

  afterAll(async () => {
    await db?.drop();
  });

  it("will not open a dispute on someone else's account", async () => {
    const res = await request(app).post('/disputes').set(as(MALLORY)).send({
      bureauAccountId: accountId,
      reason: 'not_my_account',
      description: 'Trying to read another user account details.',
    });
    expect(res.status).toBe(404);
  });

  it('creates a draft with the bureau taken from the account, and a masked ID in the letter', async () => {
    const res = await request(app).post('/disputes').set(as(ALICE)).send({
      bureauAccountId: accountId,
      reason: 'settled_in_full_not_updated',
      description: 'I settled this account in full in March 2024.',
    });
    expect(res.status).toBe(201);
    expect(res.body.bureau).toBe('experian');
    expect(res.body.status).toBe('draft');
    expect(res.body.letterContent).toContain('*********9087');
    expect(res.body.letterContent).not.toContain('8001015009087');
    disputeId = res.body.id;
  });

  it('rejects evidence keys outside the user prefix', async () => {
    const res = await request(app)
      .post('/disputes')
      .set(as(ALICE))
      .send({
        bureauAccountId: accountId,
        reason: 'incorrect_balance',
        description: 'Balance is wrong according to my statements.',
        evidenceKeys: [`uploads/${MALLORY}/x.pdf`],
      });
    expect(res.status).toBe(400);
  });

  it("hides one user's disputes from another", async () => {
    expect((await request(app).get(`/disputes/${disputeId}`).set(as(MALLORY))).status).toBe(404);
    expect((await request(app).post(`/disputes/${disputeId}/submit`).set(as(MALLORY))).status).toBe(
      404,
    );
    expect((await request(app).get('/disputes').set(as(MALLORY))).body.disputes).toEqual([]);
  });

  it('submits once, stamping a deadline; a second submit is a conflict', async () => {
    const res = await request(app).post(`/disputes/${disputeId}/submit`).set(as(ALICE));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('submitted');
    expect(res.body.resolutionDeadline).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res.body.submissionChannel).toBe('manual');

    const again = await request(app).post(`/disputes/${disputeId}/submit`).set(as(ALICE));
    expect(again.status).toBe(409);
  });

  it('serves PDF letters: the owner gets their copy, staff get an audited lodging copy', async () => {
    const mine = await request(app)
      .get(`/disputes/${disputeId}/letter.pdf`)
      .set(as(ALICE))
      .buffer(true);
    expect(mine.status).toBe(200);
    expect(mine.headers['content-type']).toBe('application/pdf');
    expect(Buffer.from(mine.body).subarray(0, 5).toString()).toBe('%PDF-');

    expect(
      (await request(app).get(`/disputes/${disputeId}/letter.pdf`).set(as(MALLORY))).status,
    ).toBe(404);
    expect(
      (await request(app).get(`/admin/disputes/${disputeId}/lodging-letter.pdf`).set(as(ALICE)))
        .status,
    ).toBe(403);

    const lodging = await request(app)
      .get(`/admin/disputes/${disputeId}/lodging-letter.pdf`)
      .set(as(ADMIN, 'admin'))
      .buffer(true);
    expect(lodging.status).toBe(200);
    const audit = await db.adminPool.query(
      "SELECT count(*)::int AS n FROM credisync.regulatory_audit_logs WHERE performed_by = $1 AND payload->>'action' = 'download_lodging_letter'",
      [ADMIN],
    );
    expect(audit.rows[0].n).toBe(1);
  });

  it('does not let the consumer escalate before the bureau deadline has passed', async () => {
    const res = await request(app)
      .post(`/disputes/${disputeId}/escalate`)
      .set(as(ALICE))
      .send({ caseNumber: 'CO-1' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('deadline_not_passed');
  });

  it('keeps operations routes for admins only', async () => {
    const res = await request(app)
      .post(`/admin/disputes/${disputeId}/bureau-reference`)
      .set(as(ALICE))
      .send({ bureauReference: 'EXP-9' });
    expect(res.status).toBe(403);

    const ok = await request(app)
      .post(`/admin/disputes/${disputeId}/bureau-reference`)
      .set(as(ADMIN, 'admin'))
      .send({ bureauReference: 'EXP-9' });
    expect(ok.status).toBe(200);
    expect(ok.body.bureauReference).toBe('EXP-9');
  });

  it('accepts only signed webhooks from the right bureau, idempotently', async () => {
    const event = {
      eventId: 'evt_0001_abcdef',
      disputeId,
      bureau: 'experian',
      response: 'Record corrected',
      reference: 'EXP-9',
      resolution: 'upheld',
    };
    const body = JSON.stringify(event);

    const unsigned = await request(app)
      .post('/webhooks/bureau-response')
      .set('Content-Type', 'application/json')
      .send(body);
    expect(unsigned.status).toBe(401);

    const wrongBureau = JSON.stringify({ ...event, bureau: 'xds' });
    const wb = await request(app)
      .post('/webhooks/bureau-response')
      .set('Content-Type', 'application/json')
      .set('X-CrediSync-Signature', signWebhook(webhookSecret('xds'), wrongBureau))
      .send(wrongBureau);
    expect(wb.status).toBe(403);

    const send = () =>
      request(app)
        .post('/webhooks/bureau-response')
        .set('Content-Type', 'application/json')
        .set('X-CrediSync-Signature', signWebhook(webhookSecret('experian'), body))
        .send(body);
    const first = await send();
    expect(first.status).toBe(200);
    expect(first.body.duplicate).toBe(false);
    const retry = await send();
    expect(retry.status).toBe(200);
    expect(retry.body.duplicate).toBe(true);

    const final = await request(app).get(`/disputes/${disputeId}`).set(as(ALICE));
    expect(final.body.status).toBe('resolved_upheld');
  });

  describe('deleting a draft', () => {
    const newDraft = async () => {
      const res = await request(app).post('/disputes').set(as(ALICE)).send({
        bureauAccountId: accountId,
        reason: 'incorrect_balance',
        description: 'The balance is wrong according to my statements.',
      });
      expect(res.status).toBe(201);
      return res.body.id as string;
    };

    it("will not delete someone else's draft", async () => {
      const id = await newDraft();
      expect((await request(app).delete(`/disputes/${id}`).set(as(MALLORY))).status).toBe(404);
      expect((await request(app).get(`/disputes/${id}`).set(as(ALICE))).status).toBe(200);
      expect((await request(app).delete(`/disputes/${id}`).set(as(ALICE))).status).toBe(204);
    });

    it('frees the account for a new dispute and leaves an audit record', async () => {
      const id = await newDraft();
      expect((await request(app).delete(`/disputes/${id}`).set(as(ALICE))).status).toBe(204);
      expect((await request(app).get(`/disputes/${id}`).set(as(ALICE))).status).toBe(404);

      const audit = await db.adminPool.query(
        "SELECT user_id, payload FROM credisync.regulatory_audit_logs WHERE resource_id = $1 AND payload->>'action' = 'delete_draft_dispute'",
        [id],
      );
      expect(audit.rows).toHaveLength(1);
      expect(audit.rows[0].user_id).toBe(ALICE);

      const replacement = await newDraft();
      expect((await request(app).delete(`/disputes/${replacement}`).set(as(ALICE))).status).toBe(
        204,
      );
    });

    it('never deletes a dispute that has been sent', async () => {
      const id = await newDraft();
      await request(app).post(`/disputes/${id}/submit`).set(as(ALICE));

      const res = await request(app).delete(`/disputes/${id}`).set(as(ALICE));
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('not_editable');
      expect((await request(app).get(`/disputes/${id}`).set(as(ALICE))).body.status).toBe(
        'submitted',
      );
    });
  });
});
