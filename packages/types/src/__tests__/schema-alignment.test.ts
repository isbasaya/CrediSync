import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  ACCOUNT_STATUSES,
  AUDIT_EVENT_TYPES,
  BANK_READINESS_TIERS,
  BUREAU_SOURCES,
  DISPUTE_REASONS,
  DISPUTE_STATUSES,
  INGESTION_SOURCES,
  SCORE_BANDS,
  TRANSACTION_CATEGORIES,
  USER_ROLES,
} from '../enums';

const schema = readFileSync(
  join(__dirname, '..', '..', '..', '..', 'db', 'schema.sql'),
  'utf-8',
).replace(/--[^\n]*/g, '');

function sqlEnum(name: string): string[] {
  const match = new RegExp(`CREATE TYPE ${name} AS ENUM \\(([^;]*?)\\);`, 's').exec(schema);
  if (!match) throw new Error(`enum ${name} not found in db/schema.sql`);
  return [...match[1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
}

describe('TypeScript enums match db/schema.sql exactly (values and order)', () => {
  const cases: Array<[string, readonly string[]]> = [
    ['score_band', SCORE_BANDS],
    ['account_status', ACCOUNT_STATUSES],
    ['bureau_source', BUREAU_SOURCES],
    ['dispute_status', DISPUTE_STATUSES],
    ['dispute_reason', DISPUTE_REASONS],
    ['transaction_category', TRANSACTION_CATEGORIES],
    ['ingestion_source', INGESTION_SOURCES],
    ['bank_readiness_tier', BANK_READINESS_TIERS],
    ['user_role', USER_ROLES],
    ['audit_event_type', AUDIT_EVENT_TYPES],
  ];

  it.each(cases)('%s', (name, values) => {
    expect([...values]).toEqual(sqlEnum(name));
  });
});
