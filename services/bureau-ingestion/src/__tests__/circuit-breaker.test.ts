import { describe, it, expect, beforeEach } from 'vitest';
import { isCircuitOpen, recordSuccess, recordFailure } from '../circuit-breaker';

describe('circuit-breaker', () => {
  const BUREAU = 'transunion';

  beforeEach(() => {
    // Reset by recording success which clears state
    recordSuccess(BUREAU);
  });

  it('starts closed', () => {
    expect(isCircuitOpen(BUREAU)).toBe(false);
  });

  it('opens after 5 consecutive failures', () => {
    for (let i = 0; i < 4; i++) {
      recordFailure(BUREAU);
    }
    expect(isCircuitOpen(BUREAU)).toBe(false);

    recordFailure(BUREAU);
    expect(isCircuitOpen(BUREAU)).toBe(true);
  });

  it('resets to closed on success', () => {
    for (let i = 0; i < 5; i++) {
      recordFailure(BUREAU);
    }
    expect(isCircuitOpen(BUREAU)).toBe(true);

    recordSuccess(BUREAU);
    expect(isCircuitOpen(BUREAU)).toBe(false);
  });

  it('tracks bureaus independently', () => {
    for (let i = 0; i < 5; i++) {
      recordFailure('experian');
    }
    expect(isCircuitOpen('experian')).toBe(true);
    expect(isCircuitOpen('xds')).toBe(false);
  });
});
