import { readFileSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { Client, Pool } from 'pg';

/**
 * Integration-test helper: creates a throwaway database, applies the real
 * db/schema.sql as a superuser, and returns a pool that connects as the
 * non-owner app role so row-level security behaves exactly as in production.
 *
 * Requires TEST_DATABASE_ADMIN_URL (a superuser URL to any database on the
 * server). Tests should skip when it is not set.
 */
export const testDatabaseAvailable = Boolean(process.env.TEST_DATABASE_ADMIN_URL);

const REPO_ROOT = join(__dirname, '..', '..', '..');

export interface TestDatabase {
  pool: Pool;
  /** Superuser pool for seeding rows that bypass RLS (e.g. making an admin). */
  adminPool: Pool;
  drop(): Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
  if (!adminUrl) throw new Error('TEST_DATABASE_ADMIN_URL is not set');

  const name = `credisync_test_${randomBytes(6).toString('hex')}`;
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();

  const dbAdminUrl = withDatabase(adminUrl, name);
  const setup = new Client({ connectionString: dbAdminUrl });
  await setup.connect();
  await setup.query(readFileSync(join(REPO_ROOT, 'db', 'dev', '00-roles.sql'), 'utf-8'));
  await setup.query(readFileSync(join(REPO_ROOT, 'db', 'schema.sql'), 'utf-8'));
  await setup.end();

  const appUrl = new URL(dbAdminUrl);
  appUrl.username = 'credisync_service';
  appUrl.password = 'credisync_service_dev';

  const pool = new Pool({ connectionString: appUrl.toString(), max: 5 });
  const adminPool = new Pool({ connectionString: dbAdminUrl, max: 2 });

  return {
    pool,
    adminPool,
    async drop() {
      await pool.end();
      await adminPool.end();
      const c = new Client({ connectionString: adminUrl });
      await c.connect();
      await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await c.end();
    },
  };
}

function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}
