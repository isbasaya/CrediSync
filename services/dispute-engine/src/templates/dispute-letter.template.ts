import type { AccountContext, ConsumerContext, DisputeReason, BureauSource } from '../types';
import { bureauContacts, CITATIONS, LEGAL_REVIEW } from './legal-references';

/** Human-readable ground-of-dispute clause, keyed by DisputeReason. */
const REASON_CLAUSES: Record<DisputeReason, string> = {
  not_my_account:
    'I have no knowledge of, and have never opened or been party to, this account. I dispute that this ' +
    'account belongs to me and request that it be investigated as a case of mistaken identity or fraud.',
  incorrect_balance:
    'The balance and/or arrears amount reflected for this account does not match my own records and ' +
    'recent statements. I dispute the accuracy of the reported balance.',
  incorrect_status:
    'The account status reported does not reflect the true, current status of this account based on my ' +
    'payment history. I dispute the accuracy of the reported status.',
  paid_but_reflecting_outstanding:
    'This account has been paid in full, yet it continues to reflect an outstanding balance and/or ' +
    'adverse status. I have attached proof of payment as supporting evidence.',
  duplicate_listing:
    'This account appears to be a duplicate listing of another account already reflected on my credit ' +
    'profile, resulting in an inflated and inaccurate view of my credit exposure.',
  identity_theft_fraud:
    'This account was opened fraudulently without my knowledge or consent. I am a victim of identity theft ' +
    'in relation to this account and have reported the matter accordingly.',
  settled_in_full_not_updated:
    'This account was settled in full on the date reflected in my supporting evidence, but the bureau ' +
    'record has not been updated to reflect the settlement.',
  prescribed_debt:
    'This debt has prescribed in terms of the Prescription Act 68 of 1969 and should no longer be listed ' +
    'as an active or collectable debt on my credit profile.',
  incorrect_personal_details:
    'My personal details as reflected against this account (name, ID number, or contact details) are ' +
    'incorrect and require correction.',
};

const STATUS_LABELS: Record<string, string> = {
  current: 'Current',
  arrears: 'In arrears',
  default: 'In default',
  judgement: 'Judgement',
  written_off: 'Written off',
  unknown: 'Not stated',
};

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(amount);
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-ZA', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Africa/Johannesburg' });
}

/** Keeps the consumer's free text from breaking the letter layout or smuggling control characters. */
function sanitiseStatement(text: string): string {
  return (
    text
      // eslint-disable-next-line no-control-regex -- intentionally strips control characters from consumer text
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .replace(/\r\n?/g, '\n')
      .trim()
      .slice(0, 4000)
      .split('\n')
      .map((line) => `  ${line}`)
      .join('\n')
  );
}

export interface DisputeLetterInput {
  consumer: ConsumerContext;
  account: AccountContext;
  bureau: BureauSource;
  reason: DisputeReason;
  description: string;
  hasEvidence?: boolean;
  today?: Date;
}

/**
 * Generates the text of a consumer dispute letter. Stored verbatim in
 * disputes.letter_content. The stored copy shows a masked ID number; the
 * submission channel attaches the full identifier securely when sending.
 */
export function generateDisputeLetter(input: DisputeLetterInput): string {
  const { consumer, account, bureau, reason, description } = input;
  const today = input.today ?? new Date();
  const contact = bureauContacts()[bureau];
  const addressee = contact.verified && contact.disputeChannel ? `${contact.displayName}\n${contact.disputeChannel}` : contact.displayName;
  const draftNotice = LEGAL_REVIEW.reviewed ? '' : '[DRAFT — statutory references pending legal review]\n\n';

  return `${draftNotice}${formatDate(today)}

${addressee}

RE: DISPUTE OF CREDIT INFORMATION — ${CITATIONS.challengeRight.toUpperCase()}

Consumer details:
  Name: ${consumer.fullName}
  ID number: ${consumer.saIdMasked}
  Mobile: ${consumer.mobileNumber}
  Email: ${consumer.email}

Disputed account (as reported by the bureau):
  Creditor: ${account.creditorName}
  Account type: ${account.accountType}
  Account reference: ${account.accountReference}
  Reported balance: ${formatCurrency(account.currentBalance)}
  Reported overdue amount: ${formatCurrency(account.overdueAmount)}
  Reported status: ${STATUS_LABELS[account.status] ?? account.status}

Ground of dispute:
  ${REASON_CLAUSES[reason]}

Consumer's statement:
${sanitiseStatement(description)}

In terms of ${CITATIONS.challengeRight}, and my right to correction of personal information under
${CITATIONS.popiaCorrection}, I request that you:
  1. Take reasonable steps to investigate the accuracy of the disputed information and respond within
     ${CITATIONS.responsePeriod} of receipt of this dispute;
  2. Correct or remove any information found to be inaccurate, incomplete, out of date or unverifiable;
  3. Notify me in writing of the outcome of your investigation and of any amendment to my credit record.

If this dispute is not resolved to my satisfaction within that period, I reserve the right to refer the
matter to ${CITATIONS.escalation}.
${input.hasEvidence ? '\nSupporting evidence is attached.\n' : ''}
Yours faithfully,

${consumer.fullName}
Submitted via CrediSync on behalf of, and with the consent of, the consumer named above.`;
}
