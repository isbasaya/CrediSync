import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import {
  createTestDatabase,
  testDatabaseAvailable,
  withSystem,
  type TestDatabase,
} from '@credisync/db';
import { InMemoryStorageProvider, setStorageProvider } from '@credisync/storage';
import { setNotificationProvider, type EmailNotification } from '@credisync/notifications';
import {
  runDeletionRequests,
  runDisputeDeadlineMonitor,
  runEvidenceMaintenance,
  parseEvidenceRetentionMonths,
  runPartitionMaintenance,
  runRetention,
} from '../jobs';
import { runOutboxRelay, type EventPublisher, type OutboxMessage } from '../outbox';

const ALICE = '11111111-1111-4111-8111-111111111111';

describe.skipIf(!testDatabaseAvailable)('scheduled jobs (real Postgres)', () => {
  let db: TestDatabase;
  const emails: EmailNotification[] = [];

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
    await withSystem(db.pool, async (c) => {
      await c.query(
        `INSERT INTO credisync.users (id, email, mobile_number, first_name, last_name, sa_id_encrypted, sa_id_hash)
         VALUES ($1, 'alice@example.co.za', '+27820000000', 'A', 'L', '\\x00', 'hash-a')`,
        [ALICE],
      );
      const cp = await c.query<{ id: string }>(
        'INSERT INTO credisync.credit_profiles (user_id) VALUES ($1) RETURNING id',
        [ALICE],
      );
      const ba = await c.query<{ id: string }>(
        `INSERT INTO credisync.bureau_accounts (credit_profile_id, user_id, bureau, account_reference, creditor_name, account_type, status, resolved_account_id)
         VALUES ($1, $2, 'xds', 'R1', 'Edcon', 'retail', 'default', $3) RETURNING id`,
        [cp.rows[0]!.id, ALICE, randomUUID()],
      );
      await c.query(
        `INSERT INTO credisync.disputes (user_id, bureau_account_id, bureau, dispute_reason, dispute_description, status, submitted_at, resolution_deadline)
         VALUES ($1, $2, 'xds', 'incorrect_balance', 'Balance is wrong per statement', 'submitted', NOW() - INTERVAL '40 days', CURRENT_DATE - 3)`,
        [ALICE, ba.rows[0]!.id],
      );
      await c.query(
        `INSERT INTO credisync.regulatory_audit_logs (user_id, event_type, created_at) VALUES ($1, 'user_login', NOW() - INTERVAL '6 years')`,
        [ALICE],
      );
      await c.query(
        `INSERT INTO credisync.regulatory_audit_logs (user_id, event_type, created_at) VALUES ($1, 'user_login', NOW() - INTERVAL '2 years')`,
        [ALICE],
      );
    });
  }, 60_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('creates partitions ahead of time', async () => {
    const names = await runPartitionMaintenance(db.pool, new Date('2030-03-01T00:00:00Z'));
    expect(names).toEqual(['transactions_2030', 'transactions_2031', 'transactions_2032']);
  });

  it('flags missed dispute deadlines once and notifies the consumer', async () => {
    expect(await runDisputeDeadlineMonitor(db.pool)).toBe(1);
    expect(await runDisputeDeadlineMonitor(db.pool)).toBe(0);
    expect(emails.some((e) => e.subject.includes('missed its deadline'))).toBe(true);
  });

  it('purges audit rows only past the 5-year floor', async () => {
    const results = await runRetention(db.pool);
    expect(results.auditLogs).toBe(1);
    const left = await db.adminPool.query(
      "SELECT count(*)::int AS n FROM credisync.regulatory_audit_logs WHERE event_type = 'user_login'",
    );
    expect(left.rows[0].n).toBe(1);
  });

  it('erases a user after the grace period and keeps a pseudonymous audit trail', async () => {
    await withSystem(db.pool, (c) =>
      c.query(
        "INSERT INTO credisync.data_deletion_requests (user_id, scheduled_for) VALUES ($1, NOW() - INTERVAL '1 minute')",
        [ALICE],
      ),
    );
    expect(await runDeletionRequests(db.pool)).toBe(1);
    const user = await db.adminPool.query('SELECT 1 FROM credisync.users WHERE id = $1', [ALICE]);
    expect(user.rowCount).toBe(0);
    const audit = await db.adminPool.query(
      "SELECT count(*)::int AS n FROM credisync.regulatory_audit_logs WHERE user_id = $1 AND event_type = 'data_deletion_completed'",
      [ALICE],
    );
    expect(audit.rows[0].n).toBe(1);
  });

  it('relays outbox events once, and backs off when publishing fails', async () => {
    const failing: EventPublisher = {
      async publish() {
        throw new Error('sns unavailable');
      },
    };
    const first = await runOutboxRelay(db.pool, failing);
    expect(first.failed).toBeGreaterThan(0);
    const pending = await db.adminPool.query(
      'SELECT attempts, last_error, next_attempt_at > NOW() AS delayed FROM credisync.event_outbox WHERE published_at IS NULL LIMIT 1',
    );
    expect(pending.rows[0]).toMatchObject({
      attempts: 1,
      last_error: 'sns unavailable',
      delayed: true,
    });

    await db.adminPool.query('UPDATE credisync.event_outbox SET next_attempt_at = NOW()');
    const sent: OutboxMessage[] = [];
    const ok: EventPublisher = {
      async publish(messages) {
        sent.push(...messages);
        return { failed: new Set<string>() };
      },
    };
    const second = await runOutboxRelay(db.pool, ok);
    expect(second.failed).toBe(0);
    expect(sent.map((m) => m.eventType).sort()).toEqual([
      'dispute.deadline_breached',
      'user.erased',
    ]);
    expect(JSON.stringify(sent)).not.toContain('alice@example.co.za');

    const again = await runOutboxRelay(db.pool, ok);
    expect(again.published).toBe(0);
  });
});

describe.skipIf(!testDatabaseAvailable)('evidence maintenance (real Postgres)', () => {
  let db: TestDatabase;
  let storage: InMemoryStorageProvider;
  const USER = '22222222-2222-4222-8222-222222222222';
  let accountId: string;

  beforeAll(async () => {
    db = await createTestDatabase();
    storage = new InMemoryStorageProvider();
    setStorageProvider(storage);
    await db.adminPool.query(
      `INSERT INTO credisync.users (id, email, mobile_number, first_name, last_name, sa_id_encrypted, sa_id_hash)
       VALUES ($1, 'bob@example.co.za', '+27820000001', 'B', 'L', '\\x00', 'hash-b')`,
      [USER],
    );
    const cp = await db.adminPool.query<{ id: string }>(
      'INSERT INTO credisync.credit_profiles (user_id) VALUES ($1) RETURNING id',
      [USER],
    );
    const ba = await db.adminPool.query<{ id: string }>(
      `INSERT INTO credisync.bureau_accounts (credit_profile_id, user_id, bureau, account_reference, creditor_name, account_type, status, resolved_account_id)
       VALUES ($1, $2, 'xds', 'R2', 'Edcon', 'retail', 'default', $3) RETURNING id`,
      [cp.rows[0]!.id, USER, randomUUID()],
    );
    accountId = ba.rows[0]!.id;
  }, 60_000);

  afterAll(async () => {
    setStorageProvider(null);
    await db?.drop();
  });

  beforeEach(async () => {
    storage.failDeletes = false;
    await db.adminPool.query('DELETE FROM credisync.dispute_evidence');
    await db.adminPool.query('DELETE FROM credisync.disputes');
  });

  // Row timestamps are set on INSERT (the updated_at trigger would overwrite them on UPDATE)
  // and, for tests that use the real clock, relative to the database NOW(), because
  // finishEvidenceErasure always uses real database time.
  async function dispute(
    status: string,
    o: { updated?: string; resolved?: string | null; escalated?: string | null } = {},
  ): Promise<string> {
    const r = await db.adminPool.query<{ id: string }>(
      `INSERT INTO credisync.disputes (user_id, bureau_account_id, bureau, dispute_reason, dispute_description, status,
         submitted_at, resolved_at, ncr_escalated_at, updated_at)
       VALUES ($1, $2, 'xds', 'incorrect_balance', 'Balance is wrong per statement', $3::dispute_status,
         CASE WHEN $3 = 'draft' THEN NULL ELSE $4::timestamptz END,
         $5::timestamptz, $6::timestamptz, $4::timestamptz)
       RETURNING id`,
      [
        USER,
        accountId,
        status,
        o.updated ?? new Date().toISOString(),
        o.resolved ?? null,
        o.escalated ?? null,
      ],
    );
    return r.rows[0]!.id;
  }

  async function evidence(
    disputeId: string | null,
    status: 'pending' | 'verified' | 'deleting',
    createdAt: string,
  ): Promise<{ id: string; key: string }> {
    const key = `evidence/${randomUUID()}`;
    storage.put(key, Buffer.from('x'), 'application/pdf');
    const r = await db.adminPool.query<{ id: string }>(
      `INSERT INTO credisync.dispute_evidence (user_id, dispute_id, storage_key, content_type, size_bytes, display_name, status,
         created_at, upload_url_expires_at, deletion_requested_at)
       VALUES ($1, $2, $3, 'application/pdf', 1, 'proof.pdf', $4::evidence_status, $5::timestamptz, $5::timestamptz + interval '15 minutes',
         CASE WHEN $4 = 'deleting' THEN $5::timestamptz ELSE NULL END)
       RETURNING id`,
      [USER, disputeId, key, status, createdAt],
    );
    return { id: r.rows[0]!.id, key };
  }

  const ago = (interval: string) =>
    db.adminPool
      .query<{ t: string }>(`SELECT (NOW() - $1::interval)::text AS t`, [interval])
      .then((r) => r.rows[0]!.t);

  const exists = async (id: string) =>
    (await db.adminPool.query('SELECT 1 FROM credisync.dispute_evidence WHERE id = $1', [id]))
      .rowCount === 1;

  it('retries rows left in deleting', async () => {
    const d = await dispute('draft');
    const e = await evidence(d, 'deleting', await ago('3 hours'));
    const res = await runEvidenceMaintenance(db.pool);
    expect(res).toMatchObject({ erased: 1, failed: 0, waiting: 0 });
    expect(await exists(e.id)).toBe(false);
    expect(storage.has(e.key)).toBe(false);
    const audit = await db.adminPool.query(
      "SELECT 1 FROM credisync.regulatory_audit_logs WHERE event_type = 'data_deletion_completed' AND resource_id = $1",
      [e.id],
    );
    expect(audit.rows).toHaveLength(1);
  });

  it('attempts deleting rows inside the margin but keeps them, counted as waiting', async () => {
    const d = await dispute('draft');
    const e = await evidence(d, 'deleting', await ago('10 minutes'));
    const res = await runEvidenceMaintenance(db.pool);
    expect(res).toMatchObject({ erased: 0, failed: 0, waiting: 1 });
    expect(await exists(e.id)).toBe(true);
    expect(storage.has(e.key)).toBe(false);
  });

  it('expires pending at 24 hours, not before', async () => {
    const d = await dispute('draft', { updated: '2024-06-01T00:00:00Z' });
    const fresh = await evidence(d, 'pending', '2024-06-01T00:00:00Z');
    const t = new Date('2024-06-02T00:00:00Z');
    let res = await runEvidenceMaintenance(db.pool, new Date(t.getTime() - 1000));
    expect(res.expiredPending).toBe(0);
    const before = await db.adminPool.query(
      'SELECT status FROM credisync.dispute_evidence WHERE id = $1',
      [fresh.id],
    );
    expect(before.rows[0].status).toBe('pending');
    res = await runEvidenceMaintenance(db.pool, t);
    expect(res.expiredPending).toBe(1);
    expect(res.erased).toBe(1);
    expect(await exists(fresh.id)).toBe(false);
    const req = await db.adminPool.query(
      "SELECT payload FROM credisync.regulatory_audit_logs WHERE event_type = 'data_deletion_request' AND resource_id = $1",
      [fresh.id],
    );
    expect(req.rows[0].payload).toEqual({ action: 'delete_evidence', evidence_id: fresh.id });
  });

  it('clears evidence on drafts idle 90 days, keeps the draft', async () => {
    const d = await dispute('draft', { updated: await ago('91 days') });
    const e = await evidence(d, 'verified', await ago('91 days'));
    const res = await runEvidenceMaintenance(db.pool);
    expect(res.staleDrafts).toBe(1);
    expect(await exists(e.id)).toBe(false);
    const kept = await db.adminPool.query('SELECT 1 FROM credisync.disputes WHERE id = $1', [d]);
    expect(kept.rowCount).toBe(1);
  });

  it('keeps evidence on a draft with a recent upload', async () => {
    const d = await dispute('draft', { updated: await ago('120 days') });
    const old = await evidence(d, 'verified', await ago('100 days'));
    const recent = await evidence(d, 'verified', await ago('5 days'));
    const res = await runEvidenceMaintenance(db.pool);
    expect(res.staleDrafts).toBe(0);
    expect(await exists(old.id)).toBe(true);
    expect(await exists(recent.id)).toBe(true);
  });

  it('keeps evidence on a draft updated recently even if uploads are old', async () => {
    const d = await dispute('draft', { updated: await ago('2 days') });
    const e = await evidence(d, 'verified', await ago('200 days'));
    expect((await runEvidenceMaintenance(db.pool)).staleDrafts).toBe(0);
    expect(await exists(e.id)).toBe(true);
  });

  it('erases 24 months after resolved_at, not one day earlier', async () => {
    const d = await dispute('resolved_upheld', { resolved: '2024-01-15T00:00:00Z' });
    const e = await evidence(d, 'verified', '2024-01-01T00:00:00Z');
    let res = await runEvidenceMaintenance(db.pool, new Date('2026-01-14T00:00:00Z'));
    expect(res.retained).toBe(0);
    expect(await exists(e.id)).toBe(true);
    res = await runEvidenceMaintenance(db.pool, new Date('2026-01-15T00:00:00Z'));
    expect(res.retained).toBe(1);
    expect(await exists(e.id)).toBe(false);
  });

  it('measures escalated disputes from ncr_escalated_at', async () => {
    const d = await dispute('escalated_ncr', {
      resolved: '2023-01-01T00:00:00Z',
      escalated: '2024-06-10T00:00:00Z',
    });
    const e = await evidence(d, 'verified', '2024-01-01T00:00:00Z');
    let res = await runEvidenceMaintenance(db.pool, new Date('2026-06-09T00:00:00Z'));
    expect(res.retained).toBe(0);
    expect(await exists(e.id)).toBe(true);
    res = await runEvidenceMaintenance(db.pool, new Date('2026-06-10T00:00:00Z'));
    expect(res.retained).toBe(1);
  });

  it('keeps evidence on resolved disputes with no resolution date', async () => {
    const d = await dispute('resolved_rejected');
    const e = await evidence(d, 'verified', '2020-01-01T00:00:00Z');
    const res = await runEvidenceMaintenance(db.pool, new Date('2040-01-01T00:00:00Z'));
    expect(res.retained).toBe(0);
    expect(await exists(e.id)).toBe(true);
  });

  it('never touches open submitted or under_review disputes', async () => {
    const ids: string[] = [];
    for (const status of ['submitted', 'under_review']) {
      const d = await dispute(status, {
        updated: '2020-01-01T00:00:00Z',
        resolved: '2020-01-01T00:00:00Z',
      });
      ids.push((await evidence(d, 'verified', '2020-01-01T00:00:00Z')).id);
    }
    const res = await runEvidenceMaintenance(db.pool, new Date('2040-01-01T00:00:00Z'));
    expect(res).toMatchObject({ erased: 0, staleDrafts: 0, retained: 0, expiredPending: 0 });
    for (const id of ids) expect(await exists(id)).toBe(true);
  });

  it('a storage failure is counted and retried next run', async () => {
    const d = await dispute('draft');
    const e = await evidence(d, 'deleting', await ago('3 hours'));
    storage.failDeletes = true;
    let res = await runEvidenceMaintenance(db.pool);
    expect(res).toMatchObject({ erased: 0, failed: 1 });
    expect(await exists(e.id)).toBe(true);
    storage.failDeletes = false;
    res = await runEvidenceMaintenance(db.pool);
    expect(res).toMatchObject({ erased: 1, failed: 0 });
    expect(await exists(e.id)).toBe(false);
  });

  it('skips a dispute locked by a live transition, then queues it next run', async () => {
    const d = await dispute('draft', { updated: await ago('91 days') });
    const e = await evidence(d, 'verified', await ago('91 days'));
    const other = await db.adminPool.connect();
    try {
      await other.query('BEGIN');
      await other.query('SELECT 1 FROM credisync.disputes WHERE id = $1 FOR UPDATE', [d]);
      const res = await runEvidenceMaintenance(db.pool);
      expect(res.staleDrafts).toBe(0);
      expect(await exists(e.id)).toBe(true);
      await other.query('COMMIT');
    } finally {
      other.release();
    }
    const next = await runEvidenceMaintenance(db.pool);
    expect(next.staleDrafts).toBe(1);
    expect(await exists(e.id)).toBe(false);
  });

  it('does not erase evidence of a dispute submitted while locked', async () => {
    const d = await dispute('draft', { updated: await ago('91 days') });
    const e = await evidence(d, 'verified', await ago('91 days'));
    const other = await db.adminPool.connect();
    try {
      await other.query('BEGIN');
      await other.query(
        "UPDATE credisync.disputes SET status = 'submitted', submitted_at = NOW() WHERE id = $1",
        [d],
      );
      const res = await runEvidenceMaintenance(db.pool);
      expect(res.staleDrafts).toBe(0);
      await other.query('COMMIT');
    } finally {
      other.release();
    }
    expect((await runEvidenceMaintenance(db.pool)).staleDrafts).toBe(0);
    expect(await exists(e.id)).toBe(true);
  });

  it('rejects an invalid EVIDENCE_RETENTION_MONTHS before queueing anything', async () => {
    const d = await dispute('resolved_upheld', { resolved: '2020-01-01T00:00:00Z' });
    const e = await evidence(d, 'verified', '2020-01-01T00:00:00Z');
    const saved = process.env.EVIDENCE_RETENTION_MONTHS;
    try {
      for (const bad of ['', '0', '-3', '1.5', 'abc', ' 12']) {
        process.env.EVIDENCE_RETENTION_MONTHS = bad;
        await expect(runEvidenceMaintenance(db.pool)).rejects.toThrow('EVIDENCE_RETENTION_MONTHS');
      }
    } finally {
      if (saved === undefined) delete process.env.EVIDENCE_RETENTION_MONTHS;
      else process.env.EVIDENCE_RETENTION_MONTHS = saved;
    }
    expect(await exists(e.id)).toBe(true);
  });

  it('processes more than one batch', async () => {
    const d = await dispute('draft');
    const created = await ago('3 hours');
    await db.adminPool.query(
      `INSERT INTO credisync.dispute_evidence (user_id, dispute_id, storage_key, content_type, size_bytes, display_name, status, created_at, upload_url_expires_at, deletion_requested_at)
       SELECT $1, $2, 'bulk/' || g, 'application/pdf', 1, 'p.pdf', 'deleting', $3::timestamptz, $3::timestamptz, $3::timestamptz
       FROM generate_series(1, 450) g`,
      [USER, d, created],
    );
    const res = await runEvidenceMaintenance(db.pool);
    expect(res.erased).toBe(450);
  });
});

describe('parseEvidenceRetentionMonths', () => {
  it('defaults to 24 when unset and accepts positive integers', () => {
    expect(parseEvidenceRetentionMonths(undefined)).toBe(24);
    expect(parseEvidenceRetentionMonths('36')).toBe(36);
  });
  it.each(['', '0', '-1', '1.5', 'abc', '12 ', '1e2', 'NaN'])('rejects %j', (bad) => {
    expect(() => parseEvidenceRetentionMonths(bad)).toThrow('EVIDENCE_RETENTION_MONTHS');
  });
});
