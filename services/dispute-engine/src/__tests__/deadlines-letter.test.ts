import { describe, it, expect } from 'vitest';
import { computeResolutionDeadline, southAfricanDate } from '../deadlines';
import { generateDisputeLetter } from '../templates/dispute-letter.template';
import { signWebhook, verifyWebhookSignature } from '../webhook-signature';
import { statusesLeadingTo } from '../state-machine';

describe('computeResolutionDeadline', () => {
  it('counts from the South African calendar date, not the UTC date', () => {
    // 00:30 SAST on Tue 27 Oct 2026 is still Mon 26 Oct in UTC.
    const justAfterMidnightSast = new Date('2026-10-26T22:30:00Z');
    expect(southAfricanDate(justAfterMidnightSast).toISOString().slice(0, 10)).toBe('2026-10-27');
    expect(computeResolutionDeadline(justAfterMidnightSast)).toBe('2026-11-24');
  });

  it('skips one-off declared public holidays', () => {
    const submitted = new Date('2026-10-27T08:00:00Z');
    expect(computeResolutionDeadline(submitted, new Set(['2026-11-02']))).toBe('2026-11-25');
  });

  it('skips the year-end public holidays', () => {
    // 16 Dec, 25 Dec and 1 Jan fall inside the window.
    expect(computeResolutionDeadline(new Date('2026-12-14T08:00:00Z'))).toBe('2027-01-14');
  });
});

describe('generateDisputeLetter', () => {
  const letter = generateDisputeLetter({
    consumer: { fullName: 'Thandi Nkosi', saIdMasked: '*********9087', mobileNumber: '+27821234567', email: 't@example.co.za' },
    account: { creditorName: 'Edcon Retail', accountType: 'retail', accountReference: 'SBX-1', currentBalance: 6420, overdueAmount: 6420, status: 'default' },
    bureau: 'transunion',
    reason: 'settled_in_full_not_updated',
    description: 'I settled this account in March 2024.\u0007 Proof attached.',
    hasEvidence: true,
    today: new Date('2026-10-25T10:00:00Z'),
  });

  it('cites section 72 and POPIA section 24, not section 71', () => {
    expect(letter).toContain('section 72 of the National Credit Act');
    expect(letter).toContain('section 24 of the Protection of Personal Information Act');
    expect(letter).not.toMatch(/section 71/i);
  });

  it('never contains a full ID number and marks itself as a draft until legally reviewed', () => {
    expect(letter).toContain('*********9087');
    expect(letter.startsWith('[DRAFT')).toBe(true);
  });

  it('does not print unverified bureau addresses', () => {
    expect(letter).not.toMatch(/PO Box/i);
  });

  it('strips control characters from the consumer statement', () => {
    expect(letter).not.toContain('\u0007');
    expect(letter).toContain('In default');
  });
});

describe('webhook signatures', () => {
  const secret = 's'.repeat(40);
  const body = '{"eventId":"evt_12345678"}';

  it('accepts a fresh, correctly signed body', () => {
    expect(verifyWebhookSignature(signWebhook(secret, body), body, secret)).toBe(true);
  });

  it('rejects a tampered body, wrong secret or stale timestamp', () => {
    const sig = signWebhook(secret, body);
    expect(verifyWebhookSignature(sig, body.replace('1', '2'), secret)).toBe(false);
    expect(verifyWebhookSignature(sig, body, 'x'.repeat(40))).toBe(false);
    const old = signWebhook(secret, body, Math.floor(Date.now() / 1000) - 3600);
    expect(verifyWebhookSignature(old, body, secret)).toBe(false);
    expect(verifyWebhookSignature(undefined, body, secret)).toBe(false);
  });
});

describe('statusesLeadingTo', () => {
  it('lists the states that may move to a target', () => {
    expect(statusesLeadingTo('submitted')).toEqual(['draft']);
    expect(statusesLeadingTo('escalated_ncr').sort()).toEqual(['resolved_rejected', 'submitted', 'under_review']);
  });
});
