import type { Dispute } from './types';

export const MIN_DESCRIPTION = 20;

type DeadlineFields = Pick<Dispute, 'status' | 'resolutionDeadline'>;

const awaitingBureau = (status: Dispute['status']) =>
  status === 'submitted' || status === 'under_review';

/** Today's calendar date in South Africa as YYYY-MM-DD, the form deadlines use. */
const southAfricanToday = (now: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' }).format(now);

/**
 * Escalation opens after a rejection, or the day after the bureau's deadline.
 * Mirrors the API's rule so the action appears as soon as the API will accept it.
 */
export function canEscalate(d: DeadlineFields, now: Date = new Date()): boolean {
  if (d.status === 'resolved_rejected') return true;
  return (
    awaitingBureau(d.status) &&
    d.resolutionDeadline !== null &&
    southAfricanToday(now) > d.resolutionDeadline.slice(0, 10)
  );
}

/** A response date only means something while the bureau still owes a response. */
export function showsResponseDue(d: DeadlineFields): boolean {
  return awaitingBureau(d.status) && d.resolutionDeadline !== null;
}
