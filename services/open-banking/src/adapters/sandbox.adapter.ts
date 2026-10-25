import { isLocalEnv } from '@credisync/config';
import type { OpenBankingAdapter, OpenBankingFetchRequest } from './open-banking-adapter.interface';
import type { IngestionSource, NormalizedAccountFeed, NormalizedTransaction } from '../types';

/**
 * SYNTHETIC transaction feed for local development and demos only: a
 * salaried consumer with typical South African debit orders. Refuses to
 * construct outside development/test.
 */
export class SandboxOpenBankingAdapter implements OpenBankingAdapter {
  constructor(readonly source: IngestionSource) {
    if (!isLocalEnv())
      throw new Error('SandboxOpenBankingAdapter is only available in development and test');
  }

  async fetchTransactions(request: OpenBankingFetchRequest): Promise<NormalizedAccountFeed> {
    const transactions: NormalizedTransaction[] = [];
    const balances: Array<{ date: string; balance: number }> = [];
    const start = new Date(`${request.periodStart}T00:00:00Z`);
    const end = new Date(`${request.periodEnd}T00:00:00Z`);

    let balance = 4200;
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const date = d.toISOString().slice(0, 10);
      const day = d.getUTCDate();
      const push = (
        id: string,
        amount: number,
        description: string,
        merchant: string | null = null,
        recurring = false,
      ) => {
        transactions.push({
          providerTransactionId: `sbx-${date}-${id}`,
          transactionDate: date,
          postedDate: date,
          amount,
          currency: 'ZAR',
          description,
          merchantName: merchant,
          reference: null,
          isRecurring: recurring,
        });
        balance += amount;
      };
      if (day === 25) push('salary', 28500, 'SALARY ACME HOLDINGS', null, true);
      if (day === 1) push('rent', -8500, 'RENTAL PAYMENT FLAT 4', null, true);
      if (day === 2) push('car', -4120, 'WESBANK VEHICLE FINANCE', 'WesBank', true);
      if (day === 3) push('ins', -980, 'OUTSURANCE PREMIUM', 'OUTsurance', true);
      if (day === 5) push('cell', -599, 'VODACOM CONTRACT', 'Vodacom', true);
      if (day % 7 === 0) push('groc', -1150, 'CHECKERS SIXTY60', 'Checkers');
      if (day % 10 === 0) push('fuel', -900, 'ENGEN GARAGE', 'Engen');
      if (day === 15) push('refund', 450, 'REFUND TAKEALOT ORDER');
      balances.push({ date, balance: Number(balance.toFixed(2)) });
    }

    return {
      source: this.source,
      accountId: `sandbox-${request.userId.slice(0, 8)}`,
      periodStart: request.periodStart,
      periodEnd: request.periodEnd,
      transactions,
      closingBalances: balances,
    };
  }
}
