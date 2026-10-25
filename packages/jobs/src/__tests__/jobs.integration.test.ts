import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import {
  createTestDatabase,
  testDatabaseAvailable,
  withSystem,
  type TestDatabase,
} from '@credisync/db';
import { setNotificationProvider, type EmailNotification } from '@credisync/notifications';
import {
  runDeletionRequests,
  runDisputeDeadlineMonitor,
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
