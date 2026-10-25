import { describe, it, expect } from 'vitest';
import { assertPasswordPolicy, AuthError, normaliseEmail } from '../service';

describe('password policy', () => {
  it('requires at least 10 characters', () => {
    expect(() => assertPasswordPolicy('short-pw')).toThrow(AuthError);
    expect(() => assertPasswordPolicy('long-enough-pw')).not.toThrow();
  });

  it('rejects passwords bcrypt would silently truncate', () => {
    expect(() => assertPasswordPolicy('é'.repeat(40))).toThrow(/72 bytes/);
  });
});

describe('normaliseEmail', () => {
  it('trims and lower-cases', () => {
    expect(normaliseEmail('  Thandi@Example.CO.za ')).toBe('thandi@example.co.za');
  });
});
