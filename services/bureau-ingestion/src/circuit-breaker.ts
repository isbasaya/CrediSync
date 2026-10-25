/**
 * Minimal per-bureau circuit breaker. Bureau APIs are B2B contracts with
 * real per-minute rate limits — repeatedly hammering a bureau that's down
 * or rate-limiting us risks the contract, not just this request. Trips
 * after 5 consecutive failures, stays open for 60s, then allows one
 * trial request (half-open) before fully resetting.
 */
type CircuitState = 'closed' | 'open' | 'half_open';

interface BreakerRecord {
  state: CircuitState;
  consecutiveFailures: number;
  openedAt: number;
}

const FAILURE_THRESHOLD = 5;
const COOLDOWN_MS = 60_000;

const breakers = new Map<string, BreakerRecord>();

function getRecord(bureau: string): BreakerRecord {
  let record = breakers.get(bureau);
  if (!record) {
    record = { state: 'closed', consecutiveFailures: 0, openedAt: 0 };
    breakers.set(bureau, record);
  }
  return record;
}

export function isCircuitOpen(bureau: string): boolean {
  const record = getRecord(bureau);
  if (record.state !== 'open') return false;

  if (Date.now() - record.openedAt >= COOLDOWN_MS) {
    record.state = 'half_open';
    return false; // allow one trial request through
  }
  return true;
}

export function recordSuccess(bureau: string): void {
  const record = getRecord(bureau);
  record.state = 'closed';
  record.consecutiveFailures = 0;
}

export function recordFailure(bureau: string): void {
  const record = getRecord(bureau);
  record.consecutiveFailures += 1;
  if (record.state === 'half_open' || record.consecutiveFailures >= FAILURE_THRESHOLD) {
    record.state = 'open';
    record.openedAt = Date.now();
  }
}
