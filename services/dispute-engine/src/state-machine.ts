import type { DisputeStatus } from './types';

/**
 * Legal lifecycle of a dispute. Mirrors the `dispute_status` enum and the
 * `dispute_ncr_requires_submission` CHECK constraint in db/schema.sql
 * (escalation requires the dispute to have been submitted first).
 *
 * escalated_ncr is reachable from 'submitted' and 'under_review' too — a
 * consumer can escalate if the bureau misses the response deadline — but
 * only once that deadline has passed (enforced in service.ts).
 */
const ALLOWED_TRANSITIONS: Record<DisputeStatus, DisputeStatus[]> = {
  draft: ['submitted'],
  submitted: ['under_review', 'resolved_upheld', 'resolved_rejected', 'escalated_ncr'],
  under_review: ['resolved_upheld', 'resolved_rejected', 'escalated_ncr'],
  resolved_upheld: [],
  resolved_rejected: ['escalated_ncr'],
  escalated_ncr: [],
};

export class InvalidTransitionError extends Error {
  constructor(from: DisputeStatus | 'unknown', to: DisputeStatus) {
    super(`Cannot transition dispute from '${from}' to '${to}'`);
    this.name = 'InvalidTransitionError';
  }
}

export function canTransition(from: DisputeStatus, to: DisputeStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertValidTransition(from: DisputeStatus, to: DisputeStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

/** Every status from which `to` may be reached; used for atomic compare-and-set updates. */
export function statusesLeadingTo(to: DisputeStatus): DisputeStatus[] {
  return (Object.keys(ALLOWED_TRANSITIONS) as DisputeStatus[]).filter((from) => ALLOWED_TRANSITIONS[from].includes(to));
}

export function isTerminalStatus(status: DisputeStatus): boolean {
  return ALLOWED_TRANSITIONS[status].length === 0;
}

/** Letters can be edited only before they are sent. */
export function isEditable(status: DisputeStatus): boolean {
  return status === 'draft';
}
