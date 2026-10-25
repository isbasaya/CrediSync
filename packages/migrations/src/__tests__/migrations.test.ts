import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { listMigrations, MIGRATIONS_DIR, splitMigration } from '../runner';

const normalise = (s: string) => s.replace(/\r\n/g, '\n');

describe('migrations', () => {
  it('keeps the initial migration byte-identical to db/schema.sql', () => {
    const schema = readFileSync(join(__dirname, '..', '..', '..', '..', 'db', 'schema.sql'), 'utf-8');
    const initial = readFileSync(join(MIGRATIONS_DIR, '20240101000000_initial_schema.sql'), 'utf-8');
    expect(normalise(initial)).toBe(normalise(schema));
  });

  it('only picks up correctly named files, in order', () => {
    const files = listMigrations();
    expect(files[0]).toBe('20240101000000_initial_schema.sql');
    expect([...files].sort()).toEqual(files);
  });

  it('splits the optional rollback section', () => {
    expect(splitMigration('CREATE TABLE x();\n-- @rollback\nDROP TABLE x;')).toEqual({ up: 'CREATE TABLE x();\n', down: 'DROP TABLE x;' });
    expect(splitMigration('CREATE TABLE x();').down).toBeNull();
  });
});
