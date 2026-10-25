import { describe, it, expect } from 'vitest';
import { maskSaIdNumber, validateSaIdNumber } from '../sa-id';

const TODAY = new Date(Date.UTC(2026, 9, 25));

describe('validateSaIdNumber', () => {
  it('accepts a well-formed ID with a valid Luhn check digit', () => {
    expect(validateSaIdNumber('8001015009087', TODAY)).toEqual({ valid: true });
    expect(validateSaIdNumber('800101 5009 087', TODAY)).toEqual({ valid: true });
  });

  it('rejects the wrong length or non-digits', () => {
    expect(validateSaIdNumber('800101500908', TODAY).reason).toBe('format');
    expect(validateSaIdNumber('80010150090ab', TODAY).reason).toBe('format');
  });

  it('rejects an impossible date of birth', () => {
    expect(validateSaIdNumber('8013015009087', TODAY).reason).toBe('date');
    expect(validateSaIdNumber('8002305009087', TODAY).reason).toBe('date');
  });

  it('rejects an invalid citizenship digit', () => {
    expect(validateSaIdNumber('8001015009287', TODAY).reason).toBe('citizenship');
  });

  it('rejects a bad check digit', () => {
    expect(validateSaIdNumber('8001015009088', TODAY).reason).toBe('checksum');
  });
});

describe('maskSaIdNumber', () => {
  it('shows only the last four digits', () => {
    expect(maskSaIdNumber('8001015009087')).toBe('*********9087');
  });
});
