import { BureauAdapter, BureauFetchError, fetchWithTimeout } from './bureau-adapter.interface';
import { mapBureauStatus, clampScore } from './status-mapping';
import type { BureauFetchRequest, NormalizedBureauReport, NormalizedBureauAccount } from '../types';

/**
 * TransUnion South Africa adapter.
 *
 * Auth: OAuth2 client-credentials against TU's SA gateway (env-configured).
 * The raw response shape below (`TransUnionRawResponse`) mirrors the
 * TransUnion "Consumer Credit Report" product structure at a high level —
 * confirm exact field names against the signed API contract before
 * go-live; this adapter isolates that risk to one file.
 */

interface TransUnionRawTrade {
  account_number: string;
  subscriber_name: string;
  account_category: string;
  account_status: string;
  date_opened: string | null;
  date_closed: string | null;
  credit_limit: number | null;
  balance: number;
  amount_overdue: number;
  instalment: number;
  months_in_arrears: number;
  worst_status_24m: string | null;
  payment_history_24m: string | null;
}

interface TransUnionRawResponse {
  consumer_score: number | null;
  trades: TransUnionRawTrade[];
  enquiries_12m: number;
  judgements: number;
  defaults: number;
}

function mapTrade(bureau: 'transunion', trade: TransUnionRawTrade): NormalizedBureauAccount {
  return {
    bureau,
    accountReference: trade.account_number,
    creditorName: trade.subscriber_name,
    accountType: trade.account_category,
    status: mapBureauStatus(bureau, trade.account_status),
    rawStatus: trade.account_status,
    openedDate: trade.date_opened,
    closedDate: trade.date_closed,
    creditLimit: trade.credit_limit,
    currentBalance: trade.balance,
    overdueAmount: trade.amount_overdue,
    instalmentAmount: trade.instalment,
    monthsInArrears: trade.months_in_arrears,
    worstStatus12m: trade.worst_status_24m ? mapBureauStatus(bureau, trade.worst_status_24m) : null,
    paymentProfile: trade.payment_history_24m,
  };
}

export class TransUnionAdapter implements BureauAdapter {
  readonly bureau = 'transunion' as const;

  constructor(
    private readonly baseUrl: string = process.env.TRANSUNION_API_BASE_URL ?? '',
    private readonly apiKey: string = process.env.TRANSUNION_API_KEY ?? '',
  ) {}

  async fetchReport(request: BureauFetchRequest): Promise<NormalizedBureauReport> {
    if (!this.baseUrl || !this.apiKey) {
      throw new BureauFetchError(
        'transunion',
        'auth',
        'missing TRANSUNION_API_BASE_URL/API_KEY',
        false,
      );
    }

    let response: Response;
    try {
      response = await fetchWithTimeout(`${this.baseUrl}/v2/consumer-report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          id_number: request.saIdNumber,
          first_name: request.firstName,
          last_name: request.lastName,
        }),
      });
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError';
      throw new BureauFetchError(
        'transunion',
        isAbort ? 'timeout' : 'upstream_error',
        String(err),
        true,
      );
    }

    if (response.status === 404) {
      throw new BureauFetchError('transunion', 'not_found', 'no file found for consumer', false);
    }
    if (response.status === 429) {
      throw new BureauFetchError(
        'transunion',
        'rate_limited',
        'TransUnion API rate limit hit',
        true,
      );
    }
    if (!response.ok) {
      throw new BureauFetchError(
        'transunion',
        'upstream_error',
        `HTTP ${response.status}`,
        response.status >= 500,
      );
    }

    const raw = (await response.json()) as TransUnionRawResponse;

    return {
      bureau: this.bureau,
      fetchedAt: new Date().toISOString(),
      score: clampScore(raw.consumer_score),
      accounts: raw.trades.map((t) => mapTrade(this.bureau, t)),
      enquiriesLast12m: raw.enquiries_12m,
      judgementsCount: raw.judgements,
      defaultsCount: raw.defaults,
    };
  }
}
