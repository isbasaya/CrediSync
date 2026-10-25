import { describe, it, expect } from 'vitest';
import { requireSecret, MissingSecretError } from '../secrets';

const opts = { devFallback: 'dev-only-fallback-value' };

describe('requireSecret', () => {
  it('returns the configured value', () => {
    expect(requireSecret('S', opts, { NODE_ENV: 'production', S: 'x'.repeat(40) })).toBe(
      'x'.repeat(40),
    );
  });

  it('uses the fallback only in development and test', () => {
    expect(requireSecret('S', opts, { NODE_ENV: 'development' })).toBe(opts.devFallback);
    expect(requireSecret('S', opts, { NODE_ENV: 'test' })).toBe(opts.devFallback);
  });

  it('refuses to start in production or staging without the secret', () => {
    expect(() => requireSecret('S', opts, { NODE_ENV: 'production' })).toThrow(MissingSecretError);
    expect(() => requireSecret('S', opts, { NODE_ENV: 'staging' })).toThrow(MissingSecretError);
  });

  it('rejects short secrets and placeholders outside development', () => {
    expect(() => requireSecret('S', opts, { NODE_ENV: 'production', S: 'short' })).toThrow(
      /at least/,
    );
    expect(() =>
      requireSecret('S', opts, {
        NODE_ENV: 'production',
        S: 'change-me-in-production-xxxxxxxxxxxxx',
      }),
    ).toThrow(/placeholder/);
  });
});
