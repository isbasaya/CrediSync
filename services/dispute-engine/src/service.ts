import { generateDisputeLetter } from './templates/dispute-letter.template';
import { computeResolutionDeadline } from './deadlines';
import { assertValidTransition } from './state-machine';
import * as db from './db';
import type { DisputeReason } from './types';

export interface CreateDisputeInput {
  userId: string;
  bureauAccountId: string;
  bureau: 'transunion' | 'experian' | 'xds';
  reason: DisputeReason;
  description: string;
  evidenceKeys: string[];
  maskedSaId: string;
}

/** Creates a draft dispute and immediately generates the letter for review. */
export async function createDispute(input: CreateDisputeInput): Promise<{ disputeId: string; letter: string }> {
  const disputeId = await db.insertDraftDispute({
    userId: input.userId,
    bureauAccountId: input.bureauAccountId,
    bureau: input.bureau,
    reason: input.reason,
    description: input.description,
    evidenceKeys: input.evidenceKeys,
  });

  const [account, consumer] = await Promise.all([
    db.fetchAccountContext(input.bureauAccountId),
    db.fetchConsumerContext(input.userId, input.maskedSaId),
  ]);

  const letter = generateDisputeLetter({
    consumer,
    account,
    bureau: input.bureau,
    reason: input.reason,
    description: input.description,
  });

  await db.saveGeneratedLetter(disputeId, letter);
  return { disputeId, letter };
}

/** Regenerates the letter for an existing dispute (e.g. after the consumer edits their statement). */
export async function regenerateLetter(disputeId: string, description: string, maskedSaId: string): Promise<string> {
  const dispute = await db.getDispute(disputeId);
  assertNotTerminal(dispute.status, disputeId);

  const [account, consumer] = await Promise.all([
    db.fetchAccountContext(dispute.bureauAccountId),
    db.fetchConsumerContext(dispute.userId, maskedSaId),
  ]);

  const letter = generateDisputeLetter({
    consumer,
    account,
    bureau: dispute.bureau,
    reason: dispute.disputeReason,
    description,
  });

  await db.saveGeneratedLetter(disputeId, letter);
  return letter;
}

/** Transitions draft -> submitted, stamps the NCA s71 resolution deadline. */
export async function submitDispute(disputeId: string, userId: string): Promise<{ resolutionDeadline: string }> {
  const currentStatus = await db.getDisputeStatus(disputeId);
  assertValidTransition(currentStatus, 'submitted');

  const resolutionDeadline = computeResolutionDeadline(new Date());
  await db.submitDispute(disputeId, userId, resolutionDeadline);
  return { resolutionDeadline };
}

export async function recordBureauResponse(disputeId: string, response: string, reference: string | null): Promise<void> {
  const currentStatus = await db.getDisputeStatus(disputeId);
  assertValidTransition(currentStatus, 'under_review');
  await db.recordBureauResponse(disputeId, response, reference);
}

export async function resolveDispute(disputeId: string, upheld: boolean): Promise<void> {
  const currentStatus = await db.getDisputeStatus(disputeId);
  assertValidTransition(currentStatus, upheld ? 'resolved_upheld' : 'resolved_rejected');
  await db.resolveDispute(disputeId, upheld);
}

export async function escalateToNcr(disputeId: string, caseNumber: string): Promise<void> {
  const currentStatus = await db.getDisputeStatus(disputeId);
  assertValidTransition(currentStatus, 'escalated_ncr');
  await db.escalateToNcr(disputeId, caseNumber);
}

function assertNotTerminal(status: string, disputeId: string): void {
  if (status === 'resolved_upheld' || status === 'escalated_ncr') {
    throw new Error(`Dispute ${disputeId} is in a terminal state ('${status}') and can no longer be edited`);
  }
}
