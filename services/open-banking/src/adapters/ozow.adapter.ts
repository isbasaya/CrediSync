import {
  OpenBankingAdapter,
  OpenBankingFetchError,
  OpenBankingFetchRequest,
  fetchWithTimeout,
} from './open-banking-adapter.interface';
import type { NormalizedAccountFeed, NormalizedTransaction } from '../types';

/**
 * Ozow adapter — used as the fallback/secondary open-banking provider
 * when a consumer's bank isn't yet covered by Stitch. Auth is an API-key
 * + site-code pair per Ozow's account-verification product; field names
 * below mirror Ozow's transaction feed shape at a high level — confirm
 * against Ozow's current API reference before go-live.
 */

interface OzowRawTransaction {
  transactionId: string;
  valueDate: string;
  processedDate: string | null;
  amount: number; // positive; direction carried separately
  direction: 'DEBIT' | 'CREDIT';
  narrative: string;
  payeeName: string | null;
  reference: string | null;
  isRecurringPayment: boolean;
}

interface OzowRawResponse {
  bankAccountId: string;
  transactions: OzowRawTransaction[];
  balanceHistory: Array<{ asOf: string; closingBalance: number }>;
}

function mapTransaction(raw: OzowRawTransaction): NormalizedTransaction {
  return {
    providerTransactionId: raw.transactionId,
    transactionDate: raw.valueDate,
    postedDate: raw.processedDate,
    amount: raw.direction === 'DEBIT' ? -Math.abs(raw.amount) : Math.abs(raw.amount),
    currency: 'ZAR',
    description: raw.narrative,
    merchantName: raw.payeeName,
    reference: raw.reference,
    isRecurring: raw.isRecurringPayment,
  };
}

export class OzowAdapter implements OpenBankingAdapter {
  readonly source = 'ozow' as const;

  constructor(
    private readonly baseUrl: string = process.env.OZOW_API_BASE_URL ?? '',
    private readonly apiKey: string = process.env.OZOW_API_KEY ?? '',
    private readonly siteCode: string = process.env.OZOW_SITE_CODE ?? '',
  ) {}

  async fetchTransactions(request: OpenBankingFetchRequest): Promise<NormalizedAccountFeed> {
    if (!this.baseUrl || !this.apiKey || !this.siteCode) {
      throw new OpenBankingFetchError(
        'ozow',
        'auth',
        'missing OZOW_API_BASE_URL/API_KEY/SITE_CODE',
      );
    }

    let response: Response;
    try {
      response = await fetchWithTimeout(`${this.baseUrl}/verification/transactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ApiKey: this.apiKey,
        },
        body: JSON.stringify({
          siteCode: this.siteCode,
          linkToken: request.accountLinkToken,
          fromDate: request.periodStart,
          toDate: request.periodEnd,
        }),
      });
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError';
      throw new OpenBankingFetchError('ozow', isAbort ? 'timeout' : 'upstream_error', String(err));
    }

    if (response.status === 401 || response.status === 403) {
      throw new OpenBankingFetchError(
        'ozow',
        'consent_revoked',
        'account link token invalid or revoked',
      );
    }
    if (!response.ok) {
      throw new OpenBankingFetchError('ozow', 'upstream_error', `HTTP ${response.status}`);
    }

    const raw = (await response.json()) as OzowRawResponse;

    return {
      source: this.source,
      accountId: raw.bankAccountId,
      periodStart: request.periodStart,
      periodEnd: request.periodEnd,
      transactions: raw.transactions.map(mapTransaction),
      closingBalances: raw.balanceHistory.map((b) => ({ date: b.asOf, balance: b.closingBalance })),
    };
  }
}
