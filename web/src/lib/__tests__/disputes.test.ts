import { describe, it, expect, vi, afterEach } from 'vitest';
import { deleteDispute, escalateDispute } from '../api-client';
import { canEscalate, showsResponseDue } from '../disputes';
import type { DisputeStatus } from '../types';

afterEach(() => vi.unstubAllGlobals());

describe('canEscalate', () => {
  const now = new Date('2026-11-23T10:00:00.000Z');
  const past = '2026-11-20';
  const today = '2026-11-23';
  const future = '2026-12-22';
  const cases: Array<[DisputeStatus, string | null, boolean]> = [
    ['draft', null, false],
    ['submitted', null, false],
    ['submitted', future, false],
    ['submitted', today, false],
    ['submitted', past, true],
    ['under_review', future, false],
    ['under_review', past, true],
    ['resolved_rejected', null, true],
    ['resolved_upheld', past, false],
    ['escalated_ncr', past, false],
  ];

  it.each(cases)('%s with deadline %s → %s', (status, resolutionDeadline, expected) => {
    expect(canEscalate({ status, resolutionDeadline }, now)).toBe(expected);
  });

  it('opens at midnight in South Africa, matching the API', () => {
    const d = { status: 'submitted' as const, resolutionDeadline: '2026-11-23' };
    expect(canEscalate(d, new Date('2026-11-23T21:59:59.000Z'))).toBe(false);
    expect(canEscalate(d, new Date('2026-11-23T22:00:00.000Z'))).toBe(true);
  });
});

describe('showsResponseDue', () => {
  const cases: Array<[DisputeStatus, string | null, boolean]> = [
    ['draft', null, false],
    ['submitted', '2026-12-22', true],
    ['under_review', '2026-12-22', true],
    ['submitted', null, false],
    ['resolved_upheld', '2026-12-22', false],
    ['resolved_rejected', '2026-12-22', false],
    ['escalated_ncr', '2026-12-22', false],
  ];

  it.each(cases)('%s with deadline %s → %s', (status, resolutionDeadline, expected) => {
    expect(showsResponseDue({ status, resolutionDeadline })).toBe(expected);
  });
});

describe('dispute actions', () => {
  const capture = (response: () => Response) => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return response();
      }),
    );
    return calls;
  };

  it('deletes a draft with a DELETE to that dispute', async () => {
    const calls = capture(() => new Response(null, { status: 204 }));
    await expect(deleteDispute('d1')).resolves.toBeUndefined();
    expect(calls[0]!.url.split('/api')[1]).toBe('/disputes/d1');
    expect(calls[0]!.init.method).toBe('DELETE');
  });

  it('sends the ombud case number the API requires when escalating', async () => {
    const calls = capture(() => new Response('{"id":"d1"}', { status: 200 }));
    await escalateDispute('d1', 'CO-123');
    expect(calls[0]!.url.split('/api')[1]).toBe('/disputes/d1/escalate');
    expect(calls[0]!.init.method).toBe('POST');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ caseNumber: 'CO-123' });
  });
});
