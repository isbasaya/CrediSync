import type { BureauSource } from '../types';

/**
 * Every statutory citation and external contact used in consumer-facing
 * dispute letters lives here so legal/compliance can review one file.
 *
 * STATUS: PENDING LEGAL REVIEW. Before go-live a South African credit-law
 * practitioner must confirm each citation and set `reviewed` with the
 * reviewer and date. Until then letters carry a "draft" notice and
 * production refuses to generate them (see assertLegalReviewComplete).
 */
export const LEGAL_REVIEW = {
  reviewed: false,
  reviewedBy: null as string | null,
  reviewedOn: null as string | null,
};

export const CITATIONS = {
  /** Right to challenge the accuracy of information held by a credit bureau. */
  challengeRight:
    'section 72 of the National Credit Act 34 of 2005 and the regulations made under it',
  /** Right to request correction of personal information. */
  popiaCorrection: 'section 24 of the Protection of Personal Information Act 4 of 2013',
  /** Response period applied by the deadline calculator (see deadlines.ts). */
  responsePeriod: '20 business days',
  /** Escalation path if unresolved. */
  escalation:
    'the Credit Ombud and, if unresolved, the National Credit Regulator in terms of Chapter 7 of the National Credit Act',
} as const;

export interface BureauContact {
  displayName: string;
  /** Verified dispute channel (postal or email). Leave null until confirmed from the bureau's official materials. */
  disputeChannel: string | null;
  verified: boolean;
}

/**
 * Bureau dispute contacts. The previous postal addresses were not verified
 * and have been removed. Populate from each bureau's signed integration
 * agreement or official consumer-dispute page, then set verified: true.
 * Overridable per environment with BUREAU_DISPUTE_CONTACTS (JSON).
 */
const DEFAULT_CONTACTS: Record<BureauSource, BureauContact> = {
  transunion: {
    displayName: 'TransUnion Credit Bureau (Pty) Ltd — Consumer Disputes',
    disputeChannel: null,
    verified: false,
  },
  experian: {
    displayName: 'Experian South Africa (Pty) Ltd — Consumer Disputes',
    disputeChannel: null,
    verified: false,
  },
  xds: {
    displayName: 'Xpert Decision Systems (XDS) — Consumer Disputes',
    disputeChannel: null,
    verified: false,
  },
};

export function bureauContacts(
  env: NodeJS.ProcessEnv = process.env,
): Record<BureauSource, BureauContact> {
  if (!env.BUREAU_DISPUTE_CONTACTS) return DEFAULT_CONTACTS;
  const overrides = JSON.parse(env.BUREAU_DISPUTE_CONTACTS) as Partial<
    Record<BureauSource, BureauContact>
  >;
  return { ...DEFAULT_CONTACTS, ...overrides };
}

export function assertLegalReviewComplete(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === 'production' && !LEGAL_REVIEW.reviewed) {
    throw new Error(
      'Dispute letter citations have not been legally reviewed; refusing to generate letters in production',
    );
  }
}
