import { describe, it, expect } from 'vitest';
import { getScoreBand } from '../enums';

describe('getScoreBand', () => {
  it('returns excellent for scores >= 767', () => {
    expect(getScoreBand(767)).toBe('excellent');
    expect(getScoreBand(999)).toBe('excellent');
  });

  it('returns good for scores 681-766', () => {
    expect(getScoreBand(681)).toBe('good');
    expect(getScoreBand(766)).toBe('good');
  });

  it('returns fair for scores 614-680', () => {
    expect(getScoreBand(614)).toBe('fair');
    expect(getScoreBand(680)).toBe('fair');
  });

  it('returns poor for scores 583-613', () => {
    expect(getScoreBand(583)).toBe('poor');
    expect(getScoreBand(613)).toBe('poor');
  });

  it('returns very_poor for scores < 583', () => {
    expect(getScoreBand(582)).toBe('very_poor');
    expect(getScoreBand(0)).toBe('very_poor');
  });
});
