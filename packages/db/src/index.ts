import { Pool, type PoolClient, type PoolConfig } from 'pg';

/**
 * Every table holding personal information has row-level security FORCED
 * (see db/schema.sql). A query only sees rows when the transaction has
 * declared who it acts for, so all access goes through one of two helpers:
 *
 *   withUser(pool, userId, fn)  – acting for one consumer; RLS limits every
 *                                 query to that consumer's rows.
 *   withSystem(pool, fn)        – explicit cross-user work (login lookup,
 *                                 admin views, scheduled jobs). Callers are
 *                                 expected to write an audit event.
 *
 * Both run `fn` inside a transaction and use set_config(..., true) so the
 * setting is scoped to that transaction and never leaks to the next user
 * of a pooled connection. (Note: `SET LOCAL x = $1` is not valid — SET
 * does not accept bind parameters.)
 */

export type Db = Pool;
export type DbClient = PoolClient;

export function createPool(config: PoolConfig = {}): Pool {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.DB_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ...config,
  });
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

async function inTransaction<T>(
  pool: Pool,
  settings: Array<[string, string]>,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [key, value] of settings) {
      await client.query('SELECT set_config($1, $2, true)', [key, value]);
    }
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export function withUser<T>(
  pool: Pool,
  userId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  if (!isUuid(userId)) {
    return Promise.reject(new Error('withUser requires a valid user UUID'));
  }
  return inTransaction(pool, [['app.current_user_id', userId]], fn);
}

export function withSystem<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return inTransaction(pool, [['app.system_context', 'on']], fn);
}

export interface AuditEvent {
  userId: string | null;
  eventType: string;
  performedBy?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  payload?: Record<string, unknown>;
  success?: boolean;
  errorMessage?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** Appends to the regulatory audit log. Payload must never contain PII. */
export async function writeAudit(client: PoolClient | Pool, event: AuditEvent): Promise<void> {
  await client.query(
    `INSERT INTO credisync.regulatory_audit_logs
       (user_id, event_type, performed_by, resource_type, resource_id, payload, success, error_message, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9::inet, $10)`,
    [
      event.userId,
      event.eventType,
      event.performedBy ?? event.userId,
      event.resourceType ?? null,
      event.resourceId ?? null,
      JSON.stringify(event.payload ?? {}),
      event.success ?? true,
      event.errorMessage ?? null,
      normaliseIp(event.ipAddress),
      event.userAgent ?? null,
    ],
  );
}

function normaliseIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  // Express reports IPv4 clients on dual-stack sockets as ::ffff:a.b.c.d
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

export { createTestDatabase, testDatabaseAvailable, type TestDatabase } from './testing';
