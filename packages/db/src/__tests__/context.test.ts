import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import { withSystem, withUser, isUuid } from '../index';

function fakePool() {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };
  const pool = { connect: vi.fn(async () => client) } as unknown as Pool;
  return { pool, client, calls };
}

const USER = '11111111-1111-4111-8111-111111111111';

describe('withUser', () => {
  it('scopes the transaction to the user with set_config, never SET with a bind parameter', async () => {
    const { pool, calls, client } = fakePool();
    await withUser(pool, USER, async (c) => c.query('SELECT 1'));

    expect(calls[0]!.sql).toBe('BEGIN');
    expect(calls[1]).toEqual({ sql: 'SELECT set_config($1, $2, true)', params: ['app.current_user_id', USER] });
    expect(calls.at(-1)!.sql).toBe('COMMIT');
    expect(calls.some((c) => /^SET\s/i.test(c.sql))).toBe(false);
    expect(client.release).toHaveBeenCalled();
  });

  it('rejects a non-UUID user id before touching the database', async () => {
    const { pool } = fakePool();
    await expect(withUser(pool, "x' OR 1=1", async () => 1)).rejects.toThrow(/valid user UUID/);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('rolls back and releases the client when the callback throws', async () => {
    const { pool, calls, client } = fakePool();
    await expect(
      withUser(pool, USER, async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(calls.at(-1)!.sql).toBe('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });
});

describe('withSystem', () => {
  it('opts into system context for the transaction only', async () => {
    const { pool, calls } = fakePool();
    await withSystem(pool, async () => undefined);
    expect(calls[1]).toEqual({ sql: 'SELECT set_config($1, $2, true)', params: ['app.system_context', 'on'] });
  });
});

describe('isUuid', () => {
  it('accepts v4 UUIDs and rejects other strings', () => {
    expect(isUuid(USER)).toBe(true);
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
});
