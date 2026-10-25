import { Pool } from 'pg';
import pino from 'pino';
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const logger = pino({ name: 'migrations' });
const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function ensureTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS credisync.schema_migrations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getApplied(): Promise<Set<string>> {
  const result = await pool.query('SELECT name FROM credisync.schema_migrations ORDER BY id');
  return new Set(result.rows.map((r: { name: string }) => r.name));
}

async function migrateUp(): Promise<void> {
  await ensureTable();
  const applied = await getApplied();

  let files: string[];
  try {
    files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  } catch {
    logger.warn('No migrations directory found');
    return;
  }

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO credisync.schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      logger.info({ file }, 'migration applied');
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error({ file, err }, 'migration failed');
      throw err;
    } finally {
      client.release();
    }
  }
}

async function migrateDown(): Promise<void> {
  await ensureTable();
  const applied = await getApplied();

  let files: string[];
  try {
    files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort().reverse();
  } catch {
    return;
  }

  for (const file of files) {
    if (!applied.has(file)) continue;

    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    const rollback = sql.includes('-- @rollback')
      ? sql.split('-- @rollback')[1]!.trim()
      : `DROP TABLE IF EXISTS credisync.${file.replace('.sql', '')} CASCADE`;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(rollback);
      await client.query('DELETE FROM credisync.schema_migrations WHERE name = $1', [file]);
      await client.query('COMMIT');
      logger.info({ file }, 'migration rolled back');
      break;
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error({ file, err }, 'rollback failed');
      throw err;
    } finally {
      client.release();
    }
  }
}

function createMigration(name: string): void {
  const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const filename = `${timestamp}_${name}.sql`;
  const template = `-- Migration: ${name}
-- Created: ${new Date().toISOString()}

-- Write your forward migration here


-- @rollback
-- Write your rollback statements here

`;
  mkdirSync(MIGRATIONS_DIR, { recursive: true });
  writeFileSync(join(MIGRATIONS_DIR, filename), template);
  logger.info({ filename }, 'migration created');
}

async function main(): Promise<void> {
  const command = process.argv[2];

  try {
    switch (command) {
      case 'up':
      case undefined:
        await migrateUp();
        break;
      case 'down':
        await migrateDown();
        break;
      case 'create':
        createMigration(process.argv[3] ?? 'unnamed');
        break;
      default:
        logger.error({ command }, 'unknown command');
        process.exit(1);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  logger.error({ err }, 'migration error');
  process.exit(1);
});
