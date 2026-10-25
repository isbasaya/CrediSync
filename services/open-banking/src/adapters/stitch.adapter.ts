import {
  OpenBankingAdapter,
  OpenBankingFetchError,
  OpenBankingFetchRequest,
  fetchWithTimeout,
} from './open-banking-adapter.interface';
import type { NormalizedAccountFeed, NormalizedTransaction } from '../types';

/**
 * Stitch (stitch.money) adapter — SA's leading open finance API. Auth is
 * an OAuth2 token exchanged during the Stitch Link consent flow; this
 * service only ever holds the resulting account-scoped access token
 * (`accountLinkToken`), never the user's actual banking credentials.
 *
 * Field names below mirror Stitch's GraphQL "AccountTransactions" query
 * shape at a high level — confirm exact fields against Stitch's current
 * API reference before go-live.
 */

interface StitchRawTransaction {
  id: string;
  date: string;
  postingDate: string | null;
  amountInCents: number; // negative = debit, per Stitch convention
  currency: string;
  description: string;
  merchant: { name: string | null } | null;
  reference: string | null;
  recurringGroupId: string | null;
}

interface StitchRawResponse {
  account: { id: string };
  transactions: StitchRawTransaction[];
  dailyBalances: Array<{ date: string; balanceInCents: number }>;
}

function mapTransaction(raw: StitchRawTransaction): NormalizedTransaction {
  return {
    providerTransactionId: raw.id,
    transactionDate: raw.date,
    postedDate: raw.postingDate,
    amount: raw.amountInCents / 100,
    currency: raw.currency,
    description: raw.description,
    merchantName: raw.merchant?.name ?? null,
    reference: raw.reference,
    isRecurring: raw.recurringGroupId !== null,
  };
}

export class StitchAdapter implements OpenBankingAdapter {
  readonly source = 'stitch' as const;

  constructor(
    private readonly baseUrl: string = process.env.STITCH_API_BASE_URL ?? '',
    private readonly clientId: string = process.env.STITCH_CLIENT_ID ?? '',
  ) {}

  async fetchTransactions(request: OpenBankingFetchRequest): Promise<NormalizedAccountFeed> {
    if (!this.baseUrl || !this.clientId) {
      throw new OpenBankingFetchError('stitch', 'auth', 'missing STITCH_API_BASE_URL/CLIENT_ID');
    }

    let response: Response;
    try {
      response = await fetchWithTimeout(`${this.baseUrl}/graphql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${request.accountLinkToken}`,
          'Client-Id': this.clientId,
        },
        body: JSON.stringify({
          query: 'query AccountTransactions($from: Date!, $to: Date!) { ... }',
          variables: { from: request.periodStart, to: request.periodEnd },
        }),
      });
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError';
      throw new OpenBankingFetchError(
        'stitch',
        isAbort ? 'timeout' : 'upstream_error',
        String(err),
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw new OpenBankingFetchError(
        'stitch',
        'consent_revoked',
        'account link token invalid or revoked',
      );
    }
    if (!response.ok) {
      throw new OpenBankingFetchError('stitch', 'upstream_error', `HTTP ${response.status}`);
    }

    const raw = (await response.json()) as StitchRawResponse;

    return {
      source: this.source,
      accountId: raw.account.id,
      periodStart: request.periodStart,
      periodEnd: request.periodEnd,
      transactions: raw.transactions.map(mapTransaction),
      closingBalances: raw.dailyBalances.map((b) => ({
        date: b.date,
        balance: b.balanceInCents / 100,
      })),
    };
  }
}
