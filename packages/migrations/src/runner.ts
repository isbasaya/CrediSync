import { Client } from 'pg';
import pino from 'pino';
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

/**
 * Applies SQL migrations in filename order, each in its own transaction,
 * under an advisory lock so two deploys can't migrate at once.
 *
 * Must connect as the schema OWNER (MIGRATION_DATABASE_URL), not as the
 * application role — the app role deliberately cannot alter the schema.
 *
 * 20240101000000_initial_schema.sql is an exact copy of db/schema.sql (a
 * test enforces this). Later changes go in new timestamped files; never
 * edit an applied migration.
 */
const logger = pino({ name: 'migrations' });
export const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');
const LOCK_KEY = 726_354_112; // arbitrary, stable advisory lock id
const ROLLBACK_MARKER = '-- @rollback';

function connectionString(): string {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('MIGRATION_DATABASE_URL (schema owner) is required');
  return url;
}

export function listMigrations(dir = MIGRATIONS_DIR): string[] {
  return readdirSync(dir)
    .filter((f) => /^\d{14}_[a-z0-9_]+\.sql$/.test(f))
    .sort();
}

export function splitMigration(sql: string): { up: string; down: string | null } {
  const index = sql.indexOf(ROLLBACK_MARKER);
  if (index === -1) return { up: sql, down: null };
  return { up: sql.slice(0, index), down: sql.slice(index + ROLLBACK_MARKER.length).trim() || null };
}

async function ensureTable(client: Client): Promise<void> {
  await client.query('CREATE SCHEMA IF NOT EXISTS credisync');
  await client.query(`
    CREATE TABLE IF NOT EXISTS credisync.schema_migrations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
}

async function withLock<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: connectionString() });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await ensureTable(client);
    return await fn(client);
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
    await client.end();
  }
}

export async function migrateUp(): Promise<string[]> {
  return withLock(async (client) => {
    const applied = new Set((await client.query<{ name: string }>('SELECT name FROM credisync.schema_migrations')).rows.map((r) => r.name));
    const ran: string[] = [];
    for (const file of listMigrations()) {
      if (applied.has(file)) continue;
      const { up } = splitMigration(readFileSync(join(MIGRATIONS_DIR, file), 'utf-8'));
      try {
        await client.query('BEGIN');
        await client.query(up);
        await client.query('INSERT INTO credisync.schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        logger.info({ file }, 'migration applied');
        ran.push(file);
      } catch (err) {
        await client.query('ROLLBACK');
        logger.error({ file, err }, 'migration failed');
        throw err;
      }
    }
    return ran;
  });
}

/** Rolls back the most recent migration, only if it declares an explicit @rollback section. */
export async function migrateDown(): Promise<string | null> {
  return withLock(async (client) => {
    const last = await client.query<{ name: string }>('SELECT name FROM credisync.schema_migrations ORDER BY id DESC LIMIT 1');
    const file = last.rows[0]?.name;
    if (!file) return null;
    const { down } = splitMigration(readFileSync(join(MIGRATIONS_DIR, file), 'utf-8'));
    if (!down) throw new Error(`${file} has no ${ROLLBACK_MARKER} section; write a new forward migration instead`);
    await client.query('BEGIN');
    try {
      await client.query(down);
      await client.query('DELETE FROM credisync.schema_migrations WHERE name = $1', [file]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
    logger.info({ file }, 'migration rolled back');
    return file;
  });
}

export function createMigration(name: string): string {
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error('migration name must be snake_case');
  const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const filename = `${timestamp}_${name}.sql`;
  const template = `-- Migration: ${name}\n-- Created: ${new Date().toISOString()}\nSET search_path TO credisync, public;\n\n-- Forward migration here\n\n\n${ROLLBACK_MARKER}\n-- Rollback statements here (optional)\n`;
  mkdirSync(MIGRATIONS_DIR, { recursive: true });
  writeFileSync(join(MIGRATIONS_DIR, filename), template);
  logger.info({ filename }, 'migration created');
  return filename;
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'up';
  if (command === 'up') await migrateUp();
  else if (command === 'down') await migrateDown();
  else if (command === 'create') createMigration(process.argv[3] ?? 'unnamed');
  else throw new Error(`unknown command ${command}`);
}

if (require.main === module) {
  main().catch((err) => {
    logger.error({ err }, 'migration error');
    process.exit(1);
  });
}
