import { createHash } from 'crypto';
import { isLocalEnv } from '@credisync/config';
import type { BureauAdapter } from './bureau-adapter.interface';
import type { BureauFetchRequest, BureauSource, NormalizedBureauAccount, NormalizedBureauReport } from '../types';

/**
 * SYNTHETIC bureau data for local development and demos only. Produces a
 * stable, realistic-looking report per user (seeded from the user id) so the
 * full refresh → resolve → dispute flow can run without bureau contracts.
 * Refuses to construct outside development/test.
 */
export class SandboxBureauAdapter implements BureauAdapter {
  constructor(readonly bureau: BureauSource) {
    if (!isLocalEnv()) {
      throw new Error('SandboxBureauAdapter is only available in development and test');
    }
  }

  async fetchReport(request: BureauFetchRequest): Promise<NormalizedBureauReport> {
    const seed = createHash('sha256').update(`${request.userId}:${this.bureau}`).digest();
    const n = (i: number, mod: number) => seed[i]! % mod;
    const drift = 1 + (n(1, 5) - 2) / 100; // ±2% reporting drift between bureaus

    const ref = (suffix: string) => `SBX-${this.bureau.slice(0, 2).toUpperCase()}-${seed.subarray(2, 5).toString('hex')}-${suffix}`;
    const accounts: NormalizedBureauAccount[] = [
      {
        bureau: this.bureau,
        accountReference: ref('HL'),
        creditorName: this.bureau === 'xds' ? 'ABSA Bank Ltd' : 'ABSA Bank',
        accountType: 'home_loan',
        status: 'current',
        rawStatus: 'current',
        openedDate: '2019-03-01',
        closedDate: null,
        creditLimit: 950000,
        currentBalance: Math.round(812000 * drift),
        overdueAmount: 0,
        instalmentAmount: 9850,
        monthsInArrears: 0,
        worstStatus12m: 'current',
        paymentProfile: '000000000000000000000000',
      },
      {
        bureau: this.bureau,
        accountReference: ref('CC'),
        creditorName: 'Standard Bank',
        accountType: 'credit_card',
        status: n(6, 3) === 0 ? 'arrears' : 'current',
        rawStatus: n(6, 3) === 0 ? 'arrears' : 'current',
        openedDate: '2021-07-15',
        closedDate: null,
        creditLimit: 45000,
        currentBalance: Math.round(31200 * drift),
        overdueAmount: n(6, 3) === 0 ? 2400 : 0,
        instalmentAmount: 1560,
        monthsInArrears: n(6, 3) === 0 ? 2 : 0,
        worstStatus12m: n(6, 3) === 0 ? 'arrears' : 'current',
        paymentProfile: null,
      },
      {
        bureau: this.bureau,
        accountReference: ref('RT'),
        creditorName: 'Edcon Retail',
        accountType: 'retail',
        status: 'default',
        rawStatus: 'in default',
        openedDate: '2016-11-02',
        closedDate: null,
        creditLimit: 8000,
        currentBalance: 6420,
        overdueAmount: 6420,
        instalmentAmount: 0,
        monthsInArrears: 9,
        worstStatus12m: 'default',
        paymentProfile: null,
      },
    ];

    return {
      bureau: this.bureau,
      fetchedAt: new Date().toISOString(),
      score: 590 + n(8, 120),
      accounts,
      enquiriesLast12m: n(9, 4),
      judgementsCount: 0,
      defaultsCount: 1,
    };
  }
}
