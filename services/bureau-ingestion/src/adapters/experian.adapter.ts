import { BureauAdapter, BureauFetchError, fetchWithTimeout } from './bureau-adapter.interface';
import { mapBureauStatus, clampScore } from './status-mapping';
import type { BureauFetchRequest, NormalizedBureauReport, NormalizedBureauAccount } from '../types';

/**
 * Experian South Africa adapter.
 *
 * Auth: mTLS client cert + API key against Experian's SA gateway.
 * Field names below mirror Experian's "Credit Profile" product shape at a
 * high level — confirm against the signed API contract before go-live.
 */

interface ExperianRawAccount {
  ref: string;
  creditor: string;
  product_type: string;
  status_code: string;
  opened: string | null;
  closed: string | null;
  limit: number | null;
  outstanding_balance: number;
  arrears_amount: number;
  monthly_payment: number;
  arrears_months: number;
  worst_status: string | null;
  payment_string: string | null;
}

interface ExperianRawResponse {
  bureau_score: number | null;
  accounts: ExperianRawAccount[];
  enquiries_last_year: number;
  judgement_count: number;
  default_count: number;
}

function mapAccount(bureau: 'experian', acc: ExperianRawAccount): NormalizedBureauAccount {
  return {
    bureau,
    accountReference: acc.ref,
    creditorName: acc.creditor,
    accountType: acc.product_type,
    status: mapBureauStatus(bureau, acc.status_code),
    rawStatus: acc.status_code,
    openedDate: acc.opened,
    closedDate: acc.closed,
    creditLimit: acc.limit,
    currentBalance: acc.outstanding_balance,
    overdueAmount: acc.arrears_amount,
    instalmentAmount: acc.monthly_payment,
    monthsInArrears: acc.arrears_months,
    worstStatus12m: acc.worst_status ? mapBureauStatus(bureau, acc.worst_status) : null,
    paymentProfile: acc.payment_string,
  };
}

export class ExperianAdapter implements BureauAdapter {
  readonly bureau = 'experian' as const;

  constructor(
    private readonly baseUrl: string = process.env.EXPERIAN_API_BASE_URL ?? '',
    private readonly apiKey: string = process.env.EXPERIAN_API_KEY ?? ''
  ) {}

  async fetchReport(request: BureauFetchRequest): Promise<NormalizedBureauReport> {
    if (!this.baseUrl || !this.apiKey) {
      throw new BureauFetchError('experian', 'auth', 'missing EXPERIAN_API_BASE_URL/API_KEY', false);
    }

    let response: Response;
    try {
      response = await fetchWithTimeout(`${this.baseUrl}/credit-profile`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': this.apiKey,
        },
        body: JSON.stringify({
          id_number: request.saIdNumber,
          given_name: request.firstName,
          surname: request.lastName,
        }),
      });
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError';
      throw new BureauFetchError('experian', isAbort ? 'timeout' : 'upstream_error', String(err), true);
    }

    if (response.status === 404) {
      throw new BureauFetchError('experian', 'not_found', 'no file found for consumer', false);
    }
    if (response.status === 429) {
      throw new BureauFetchError('experian', 'rate_limited', 'Experian API rate limit hit', true);
    }
    if (!response.ok) {
      throw new BureauFetchError('experian', 'upstream_error', `HTTP ${response.status}`, response.status >= 500);
    }

    const raw = (await response.json()) as ExperianRawResponse;

    return {
      bureau: this.bureau,
      fetchedAt: new Date().toISOString(),
      score: clampScore(raw.bureau_score),
      accounts: raw.accounts.map((a) => mapAccount(this.bureau, a)),
      enquiriesLast12m: raw.enquiries_last_year,
      judgementsCount: raw.judgement_count,
      defaultsCount: raw.default_count,
    };
  }
}
