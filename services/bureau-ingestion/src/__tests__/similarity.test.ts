import { describe, it, expect } from 'vitest';
import {
  creditorNameSimilarity,
  amountCloseness,
  dateCloseness,
  normalizeCreditorName,
} from '../entity-resolution/similarity';

describe('normalizeCreditorName', () => {
  it('lowercases and strips noise words', () => {
    expect(normalizeCreditorName('ABSA Bank Ltd')).toBe('absa');
    expect(normalizeCreditorName('Standard Bank South Africa')).toBe('standard');
  });

  it('removes punctuation', () => {
    expect(normalizeCreditorName('Woolworths (Pty) Ltd')).toBe('woolworths');
  });

  it('handles empty strings', () => {
    expect(normalizeCreditorName('')).toBe('');
    expect(normalizeCreditorName('Ltd')).toBe('');
  });
});

describe('creditorNameSimilarity', () => {
  it('returns 1 for identical names after normalization', () => {
    expect(creditorNameSimilarity('ABSA Bank', 'ABSA Bank Ltd')).toBe(1);
  });

  it('returns 0 for empty inputs', () => {
    expect(creditorNameSimilarity('', 'ABSA')).toBe(0);
  });

  it('returns high similarity for minor typos', () => {
    const sim = creditorNameSimilarity('Capitec', 'Capitek');
    expect(sim).toBeGreaterThan(0.7);
    expect(sim).toBeLessThan(1);
  });

  it('returns low similarity for different names', () => {
    const sim = creditorNameSimilarity('ABSA', 'Standard Bank');
    expect(sim).toBeLessThan(0.5);
  });
});

describe('amountCloseness', () => {
  it('returns 1 for identical amounts', () => {
    expect(amountCloseness(5000, 5000)).toBe(1);
  });

  it('returns 1 for both zero', () => {
    expect(amountCloseness(0, 0)).toBe(1);
  });

  it('returns 1 for amounts within 2%', () => {
    expect(amountCloseness(1000, 1010)).toBe(1);
  });

  it('returns 0 for amounts >25% apart', () => {
    expect(amountCloseness(1000, 1500)).toBe(0);
  });

  it('returns partial score for amounts between 2-25% apart', () => {
    const score = amountCloseness(1000, 1100);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });
});

describe('dateCloseness', () => {
  it('returns 1 for identical dates', () => {
    expect(dateCloseness('2024-01-15', '2024-01-15')).toBe(1);
  });

  it('returns 1 for dates within 7 days', () => {
    expect(dateCloseness('2024-01-15', '2024-01-20')).toBe(1);
  });

  it('returns 0 for dates >= 90 days apart', () => {
    expect(dateCloseness('2024-01-01', '2024-04-15')).toBe(0);
  });

  it('returns 0.5 for null dates', () => {
    expect(dateCloseness(null, '2024-01-01')).toBe(0.5);
    expect(dateCloseness(null, null)).toBe(0.5);
  });

  it('returns partial score for dates between 7-90 days apart', () => {
    const score = dateCloseness('2024-01-01', '2024-02-01');
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });
});
