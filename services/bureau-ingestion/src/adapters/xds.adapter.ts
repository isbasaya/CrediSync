import { BureauAdapter, BureauFetchError, fetchWithTimeout } from './bureau-adapter.interface';
import { mapBureauStatus, clampScore } from './status-mapping';
import type { BureauFetchRequest, NormalizedBureauReport, NormalizedBureauAccount } from '../types';

/**
 * XDS (Xpert Decision Systems) adapter.
 *
 * Auth: API key + HMAC-signed request against XDS's SA gateway.
 * Field names below mirror XDS's consumer bureau report shape at a high
 * level — confirm against the signed API contract before go-live.
 */

interface XdsRawFacility {
  facility_id: string;
  lender: string;
  facility_type: string;
  current_status: string;
  start_date: string | null;
  end_date: string | null;
  approved_limit: number | null;
  balance_outstanding: number;
  amount_in_arrears: number;
  instalment: number;
  arrears_period_months: number;
  status_12m_worst: string | null;
  history_string_24m: string | null;
}

interface XdsRawResponse {
  score: number | null;
  facilities: XdsRawFacility[];
  enquiries_12m: number;
  judgements_count: number;
  defaults_count: number;
}

function mapFacility(bureau: 'xds', f: XdsRawFacility): NormalizedBureauAccount {
  return {
    bureau,
    accountReference: f.facility_id,
    creditorName: f.lender,
    accountType: f.facility_type,
    status: mapBureauStatus(bureau, f.current_status),
    openedDate: f.start_date,
    closedDate: f.end_date,
    creditLimit: f.approved_limit,
    currentBalance: f.balance_outstanding,
    overdueAmount: f.amount_in_arrears,
    instalmentAmount: f.instalment,
    monthsInArrears: f.arrears_period_months,
    worstStatus12m: f.status_12m_worst ? mapBureauStatus(bureau, f.status_12m_worst) : null,
    paymentProfile: f.history_string_24m,
  };
}

export class XdsAdapter implements BureauAdapter {
  readonly bureau = 'xds' as const;

  constructor(
    private readonly baseUrl: string = process.env.XDS_API_BASE_URL ?? '',
    private readonly apiKey: string = process.env.XDS_API_KEY ?? ''
  ) {}

  async fetchReport(request: BureauFetchRequest): Promise<NormalizedBureauReport> {
    if (!this.baseUrl || !this.apiKey) {
      throw new BureauFetchError('xds', 'auth', 'missing XDS_API_BASE_URL/API_KEY', false);
    }

    let response: Response;
    try {
      response = await fetchWithTimeout(`${this.baseUrl}/bureau/report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-XDS-Api-Key': this.apiKey,
        },
        body: JSON.stringify({
          national_id_hash: request.saIdHash,
          first_name: request.firstName,
          last_name: request.lastName,
        }),
      });
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError';
      throw new BureauFetchError('xds', isAbort ? 'timeout' : 'upstream_error', String(err), true);
    }

    if (response.status === 404) {
      throw new BureauFetchError('xds', 'not_found', 'no file found for consumer', false);
    }
    if (response.status === 429) {
      throw new BureauFetchError('xds', 'rate_limited', 'XDS API rate limit hit', true);
    }
    if (!response.ok) {
      throw new BureauFetchError('xds', 'upstream_error', `HTTP ${response.status}`, response.status >= 500);
    }

    const raw = (await response.json()) as XdsRawResponse;

    return {
      bureau: this.bureau,
      fetchedAt: new Date().toISOString(),
      score: clampScore(raw.score),
      accounts: raw.facilities.map((f) => mapFacility(this.bureau, f)),
      enquiriesLast12m: raw.enquiries_12m,
      judgementsCount: raw.judgements_count,
      defaultsCount: raw.defaults_count,
    };
  }
}
