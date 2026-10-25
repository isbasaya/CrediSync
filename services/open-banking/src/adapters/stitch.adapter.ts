import {
  OpenBankingAdapter,
  OpenBankingFetchError,
  OpenBankingFetchRequest,
  fetchWithTimeout,
} from './open-banking-adapter.interface';
import type { NormalizedAccountFeed, NormalizedTransaction } from '../types';

/**
 * Stitch (stitch.money) GraphQL adapter. The access token is the consumer's
 * Stitch user token from the consent flow (see providers/stitch-oauth.ts).
 *
 * Shape used (from Stitch's docs and examples; CONFIRM against the schema in
 * the Stitch sandbox IDE before go-live):
 *   user { bankAccounts { id name } }
 *   node(id: $accountId) { ... on BankAccount {
 *     transactions(first, after) { pageInfo { hasNextPage endCursor }
 *       edges { node { id amount { quantity currency } date description reference
 *                      runningBalance { quantity currency } } } } } }
 * Transactions are returned newest first, so paging stops once a page
 * reaches dates before the requested period.
 */
export const STITCH_GRAPHQL_URL = 'https://api.stitch.money/graphql';

const ACCOUNTS_QUERY = `query CrediSyncAccounts { user { bankAccounts { id name } } }`;

const TRANSACTIONS_QUERY = `query CrediSyncTransactions($accountId: ID!, $first: UInt, $after: Cursor) {
  node(id: $accountId) {
    ... on BankAccount {
      transactions(first: $first, after: $after) {
        pageInfo { hasNextPage endCursor }
        edges { node { id amount { quantity currency } date description reference runningBalance { quantity currency } } }
      }
    }
  }
}`;

interface Money {
  quantity: string | number;
  currency: string;
}

interface StitchTransactionNode {
  id: string;
  amount: Money;
  date: string;
  description: string | null;
  reference: string | null;
  runningBalance: Money | null;
}

interface TransactionsPage {
  node: {
    transactions: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      edges: Array<{ node: StitchTransactionNode }>;
    };
  } | null;
}

const PAGE_SIZE = 500;
const MAX_PAGES_PER_ACCOUNT = 40;

export class StitchAdapter implements OpenBankingAdapter {
  readonly source = 'stitch' as const;

  constructor(
    private readonly graphqlUrl: string = process.env.STITCH_API_BASE_URL
      ? `${process.env.STITCH_API_BASE_URL}/graphql`
      : STITCH_GRAPHQL_URL,
  ) {}

  private async graphql<T>(
    token: string,
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetchWithTimeout(this.graphqlUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ query, variables }),
      });
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError';
      throw new OpenBankingFetchError(
        'stitch',
        isAbort ? 'timeout' : 'upstream_error',
        'request failed',
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new OpenBankingFetchError('stitch', 'consent_revoked', 'user token invalid or revoked');
    }
    if (!response.ok)
      throw new OpenBankingFetchError('stitch', 'upstream_error', `HTTP ${response.status}`);

    const body = (await response.json()) as {
      data?: T;
      errors?: Array<{ message?: string; extensions?: { code?: string } }>;
    };
    if (body.errors?.length) {
      const unauth = body.errors.some((e) =>
        /unauth|forbidden|token/i.test(`${e.extensions?.code ?? ''} ${e.message ?? ''}`),
      );
      throw new OpenBankingFetchError(
        'stitch',
        unauth ? 'consent_revoked' : 'upstream_error',
        'GraphQL error',
      );
    }
    if (!body.data)
      throw new OpenBankingFetchError('stitch', 'upstream_error', 'empty GraphQL response');
    return body.data;
  }

  async fetchTransactions(request: OpenBankingFetchRequest): Promise<NormalizedAccountFeed> {
    const token = request.accountLinkToken;
    const accounts = (
      await this.graphql<{ user: { bankAccounts: Array<{ id: string; name: string }> } }>(
        token,
        ACCOUNTS_QUERY,
      )
    ).user.bankAccounts;
    if (accounts.length === 0)
      throw new OpenBankingFetchError('stitch', 'upstream_error', 'no bank accounts on this link');

    const transactions: NormalizedTransaction[] = [];
    const primaryBalances = new Map<string, number>();

    for (const [index, account] of accounts.entries()) {
      let after: string | null = null;
      for (let page = 0; page < MAX_PAGES_PER_ACCOUNT; page++) {
        const data: TransactionsPage = await this.graphql<TransactionsPage>(
          token,
          TRANSACTIONS_QUERY,
          {
            accountId: account.id,
            first: PAGE_SIZE,
            after,
          },
        );
        const conn = data.node?.transactions;
        if (!conn) break;

        let reachedStart = false;
        for (const { node } of conn.edges) {
          const date = node.date.slice(0, 10);
          if (date < request.periodStart) {
            reachedStart = true;
            continue;
          }
          if (date > request.periodEnd) continue;
          transactions.push({
            providerTransactionId: node.id,
            transactionDate: date,
            postedDate: date,
            amount: Number(node.amount.quantity),
            currency: node.amount.currency,
            description: node.description ?? node.reference ?? '',
            merchantName: null,
            reference: node.reference,
            isRecurring: false,
          });
          // Closing balance for a day = running balance after that day's latest
          // transaction (the first one seen, as results are newest first).
          if (index === 0 && node.runningBalance && !primaryBalances.has(date)) {
            primaryBalances.set(date, Number(node.runningBalance.quantity));
          }
        }
        if (reachedStart || !conn.pageInfo.hasNextPage || !conn.pageInfo.endCursor) break;
        after = conn.pageInfo.endCursor;
      }
    }

    return {
      source: this.source,
      accountId: accounts[0]!.id,
      periodStart: request.periodStart,
      periodEnd: request.periodEnd,
      transactions,
      closingBalances: [...primaryBalances.entries()]
        .map(([date, balance]) => ({ date, balance }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    };
  }
}
