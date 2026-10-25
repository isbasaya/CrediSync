import type { DisputeStatus } from './types';

/**
 * Legal lifecycle of a dispute. Mirrors the `dispute_status` enum and the
 * `dispute_ncr_requires_submission` CHECK constraint in db/schema.sql
 * (escalation requires the dispute to have been submitted first).
 *
 * escalated_ncr is reachable from 'submitted' and 'under_review' too, not
 * just 'resolved_rejected' — a consumer can escalate to the NCR if the
 * bureau simply misses the 20-business-day deadline without responding.
 */
const ALLOWED_TRANSITIONS: Record<DisputeStatus, DisputeStatus[]> = {
  draft: ['submitted'],
  submitted: ['under_review', 'escalated_ncr'],
  under_review: ['resolved_upheld', 'resolved_rejected', 'escalated_ncr'],
  resolved_upheld: [],
  resolved_rejected: ['escalated_ncr'],
  escalated_ncr: [],
};

export class InvalidTransitionError extends Error {
  constructor(from: DisputeStatus, to: DisputeStatus) {
    super(`Cannot transition dispute from '${from}' to '${to}'`);
    this.name = 'InvalidTransitionError';
  }
}

export function assertValidTransition(from: DisputeStatus, to: DisputeStatus): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new InvalidTransitionError(from, to);
  }
}

export function isTerminalStatus(status: DisputeStatus): boolean {
  return ALLOWED_TRANSITIONS[status].length === 0;
}
