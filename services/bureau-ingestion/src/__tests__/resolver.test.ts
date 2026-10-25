import { describe, it, expect } from 'vitest';
import { resolveEntities } from '../entity-resolution/resolver';
import { buildUnifiedProfile } from '../entity-resolution/merge';
import { normaliseScore, loadScoreRanges } from '../entity-resolution/score-normalisation';
import { mapBureauStatus } from '../adapters/status-mapping';
import type { NormalizedBureauAccount, NormalizedBureauReport } from '../types';

function account(overrides: Partial<NormalizedBureauAccount>): NormalizedBureauAccount {
  return {
    bureau: 'transunion',
    accountReference: 'REF',
    creditorName: 'ABSA Bank',
    accountType: 'home_loan',
    status: 'current',
    rawStatus: 'current',
    openedDate: '2019-03-01',
    closedDate: null,
    creditLimit: 950000,
    currentBalance: 812000,
    overdueAmount: 0,
    instalmentAmount: 9850,
    monthsInArrears: 0,
    worstStatus12m: null,
    paymentProfile: null,
    ...overrides,
  };
}

describe('resolveEntities', () => {
  const tu = account({ bureau: 'transunion', accountReference: 'TU-1' });
  const ex = account({ bureau: 'experian', accountReference: 'EX-1', creditorName: 'ABSA Bank Ltd', currentBalance: 815000 });

  it('merges the same facility reported by two bureaus and keeps each bureau record unmodified', () => {
    const clusters = resolveEntities([[tu], [ex]]);
    expect(clusters).toHaveLength(1);
    const members = clusters[0]!.members.map((m) => m.account);
    expect(members.find((m) => m.bureau === 'experian')!.currentBalance).toBe(815000);
    expect(clusters[0]!.canonical.currentBalance).toBe(815000); // conservative max
  });

  it('never merges different product types from the same creditor', () => {
    const card = account({ bureau: 'experian', accountReference: 'EX-2', accountType: 'credit_card', creditLimit: null, openedDate: null });
    const clusters = resolveEntities([[tu], [card]]);
    expect(clusters).toHaveLength(2);
  });

  it('never merges two accounts from the same bureau', () => {
    const twin = account({ bureau: 'transunion', accountReference: 'TU-2' });
    expect(resolveEntities([[tu, twin]])).toHaveLength(2);
  });

  it('gives the same result and the same cluster ids regardless of input order', () => {
    const a = resolveEntities([[tu], [ex]]);
    const b = resolveEntities([[ex], [tu]]);
    expect(a.map((c) => c.resolvedAccountId)).toEqual(b.map((c) => c.resolvedAccountId));
    expect(a[0]!.resolvedAccountId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('uses the worst status across bureaus for the canonical record', () => {
    const late = account({ bureau: 'experian', accountReference: 'EX-3', status: 'arrears' });
    const [cluster] = resolveEntities([[tu], [late]]);
    expect(cluster!.canonical.status).toBe('arrears');
  });
});

describe('buildUnifiedProfile', () => {
  const report = (bureau: NormalizedBureauReport['bureau'], score: number | null, accounts: NormalizedBureauAccount[]) => ({
    bureau,
    fetchedAt: new Date().toISOString(),
    score,
    accounts,
    enquiriesLast12m: 1,
    judgementsCount: 0,
    defaultsCount: 0,
  });

  it('does not count unknown statuses as adverse', () => {
    const profile = buildUnifiedProfile([report('transunion', 650, [account({ status: 'unknown' })])]);
    expect(profile.adverseAccounts).toBe(0);
  });

  it('normalises scores to a common scale before averaging', () => {
    const ranges = { transunion: [0, 999], experian: [300, 850], xds: [0, 999] } as const;
    const profile = buildUnifiedProfile([report('transunion', 999, []), report('experian', 850, [])], ranges);
    expect(profile.unifiedScore).toBe(999);
    expect(profile.experianScore).toBe(850); // stored as reported
  });

  it('excludes thin-file bureaus from the unified score', () => {
    const profile = buildUnifiedProfile([report('transunion', 700, []), report('xds', null, [])]);
    expect(profile.unifiedScore).toBe(700);
  });
});

describe('score normalisation', () => {
  it('maps a bureau range onto 0–999 and clamps out-of-range values', () => {
    const ranges = { transunion: [0, 999], experian: [300, 850], xds: [0, 999] } as const;
    expect(normaliseScore('experian', 300, ranges)).toBe(0);
    expect(normaliseScore('experian', 900, ranges)).toBe(999);
  });

  it('validates BUREAU_SCORE_RANGES', () => {
    expect(() => loadScoreRanges({ BUREAU_SCORE_RANGES: '{"xds":[500,100]}' })).toThrow(/max > min/);
    expect(loadScoreRanges({ BUREAU_SCORE_RANGES: '{"xds":[0,700]}' }).xds).toEqual([0, 700]);
  });
});

describe('mapBureauStatus', () => {
  it('maps closed and settled accounts as in good standing', () => {
    expect(mapBureauStatus('transunion', 'Paid Up')).toBe('current');
    expect(mapBureauStatus('xds', 'closed')).toBe('current');
  });

  it('records unmapped statuses as unknown, never as adverse', () => {
    expect(mapBureauStatus('experian', 'Z9-UNMAPPED')).toBe('unknown');
  });
});
