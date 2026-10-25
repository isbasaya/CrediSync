import type { AccountContext, ConsumerContext, DisputeReason, BureauSource } from '../types';

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

const BUREAU_DISPUTE_ADDRESS: Record<BureauSource, string> = {
  transunion: 'TransUnion South Africa — Consumer Disputes Department, PO Box 4041, Johannesburg, 2000',
  experian: 'Experian South Africa — Consumer Affairs Department, PO Box 214, Johannesburg, 2000',
  xds: 'XDS (Pty) Ltd — Consumer Disputes Department, PO Box 3007, Rivonia, 2128',
};

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(amount);
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-ZA', { year: 'numeric', month: 'long', day: 'numeric' });
}

export interface DisputeLetterInput {
  consumer: ConsumerContext;
  account: AccountContext;
  bureau: BureauSource;
  reason: DisputeReason;
  description: string;
  today?: Date;
}

/**
 * Generates the body of an NCA/NCR-compliant dispute letter. Output is
 * stored verbatim in `disputes.letter_content` and re-rendered to
 * PDF/email at submission time — this function only produces the text.
 */
export function generateDisputeLetter(input: DisputeLetterInput): string {
  const { consumer, account, bureau, reason, description } = input;
  const today = input.today ?? new Date();

  return `${formatDate(today)}

${BUREAU_DISPUTE_ADDRESS[bureau]}

RE: FORMAL DISPUTE OF CREDIT INFORMATION — SECTION 71, NATIONAL CREDIT ACT 34 OF 2005

Consumer Details:
  Name: ${consumer.fullName}
  ID Number: ${consumer.saIdMasked}
  Mobile: ${consumer.mobileNumber}
  Email: ${consumer.email}

Disputed Account Details:
  Creditor: ${account.creditorName}
  Account Type: ${account.accountType}
  Account Reference: ${account.accountReference}
  Reported Balance: ${formatCurrency(account.currentBalance)}
  Reported Overdue Amount: ${formatCurrency(account.overdueAmount)}
  Reported Status: ${account.status}

Ground of Dispute:
  ${REASON_CLAUSES[reason]}

Consumer's Statement:
  ${description}

In terms of Section 71 of the National Credit Act 34 of 2005, I request that you:
  1. Take reasonable steps to investigate the accuracy of the disputed information within 20 business days
     of receipt of this dispute;
  2. Take reasonable steps to correct or remove any information found to be inaccurate, obsolete, or
     unverifiable;
  3. Notify me in writing of the outcome of your investigation and any resulting amendment to my credit
     record.

Should this dispute not be resolved to my satisfaction within the statutory period, I reserve the right to
escalate this matter to the National Credit Regulator (NCR) in terms of Section 141 of the National Credit
Act.

I have attached supporting evidence in relation to this dispute where applicable.

Yours faithfully,

${consumer.fullName}
Submitted via CrediSync on behalf of the consumer named above.`;
}
