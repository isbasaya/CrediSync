import type { Pool, PoolClient } from 'pg';
import { withUser, writeAudit } from '@credisync/db';
import { decryptFromBytes, encryptToBytes } from '@credisync/crypto';
import type { FinancialHealthSnapshot, IngestionSource } from './types';

export class OpenBankingError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'OpenBankingError';
  }
}

async function assertConsent(client: PoolClient, userId: string): Promise<void> {
  const r = await client.query<{ open_banking_consent: boolean }>(
    'SELECT open_banking_consent FROM credisync.users WHERE id = $1 AND is_active',
    [userId]
  );
  if (!r.rows[0]?.open_banking_consent) {
    throw new OpenBankingError(403, 'open_banking_consent_required', 'Give permission to read your bank transactions first');
  }
}

/** Stores the provider token from the consent/link flow, encrypted. The token is never returned to clients. */
export async function createLink(pool: Pool, userId: string, source: IngestionSource, accountLinkToken: string) {
  return withUser(pool, userId, async (client) => {
    await assertConsent(client, userId);
    const r = await client.query<{ id: string; created_at: Date }>(
      `INSERT INTO credisync.open_banking_links (user_id, source, token_encrypted) VALUES ($1, $2, $3) RETURNING id, created_at`,
      [userId, source, await encryptToBytes(accountLinkToken)]
    );
    await writeAudit(client, { userId, eventType: 'bank_link_created', resourceType: 'open_banking_link', resourceId: r.rows[0]!.id, payload: { source } });
    return { id: r.rows[0]!.id, source, createdAt: r.rows[0]!.created_at.toISOString() };
  });
}

export async function listLinks(pool: Pool, userId: string) {
  return withUser(pool, userId, async (client) => {
    const r = await client.query(
      'SELECT id, source, created_at, revoked_at FROM credisync.open_banking_links WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );
    return r.rows.map((row) => ({
      id: row.id as string,
      source: row.source as IngestionSource,
      createdAt: new Date(row.created_at).toISOString(),
      revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
    }));
  });
}

export async function revokeLink(pool: Pool, userId: string, linkId: string): Promise<void> {
  await withUser(pool, userId, async (client) => {
    const r = await client.query(
      'UPDATE credisync.open_banking_links SET token_encrypted = NULL, revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL',
      [linkId]
    );
    if (!r.rowCount) throw new OpenBankingError(404, 'not_found', 'Bank link not found');
  });
}

/** Re-checks consent and decrypts the provider token for one ingest. */
export async function loadLinkToken(pool: Pool, userId: string, linkId: string): Promise<{ source: IngestionSource; token: string }> {
  const row = await withUser(pool, userId, async (client) => {
    await assertConsent(client, userId);
    const r = await client.query('SELECT source, token_encrypted, revoked_at FROM credisync.open_banking_links WHERE id = $1', [linkId]);
    return r.rows[0];
  });
  if (!row) throw new OpenBankingError(404, 'not_found', 'Bank link not found');
  if (row.revoked_at || !row.token_encrypted) throw new OpenBankingError(409, 'link_revoked', 'This bank link was disconnected. Link your account again.');
  return { source: row.source, token: await decryptFromBytes(row.token_encrypted) };
}

const BATCH_SIZE = 500;

/**
 * Persists a snapshot and its transactions in one transaction. Transactions
 * already stored for this user (same provider id) are skipped, so
 * overlapping ingest periods never double-count.
 */
export async function persistSnapshot(pool: Pool, snapshot: FinancialHealthSnapshot): Promise<{ snapshotId: string; inserted: number }> {
  return withUser(pool, snapshot.userId, async (client) => {
    const s = snapshot;
    const ins = await client.query<{ id: string }>(
      `INSERT INTO credisync.financial_health_snapshots (
         user_id, period_start, period_end, period_months, ingestion_source,
         gross_income, net_income, income_streams, income_regularity_score, unclassified_credits,
         housing_expenses, transport_expenses, food_expenses, utilities_expenses,
         insurance_expenses, debt_repayment_total, entertainment_expenses, gambling_spend,
         debt_to_income_ratio, savings_rate,
         average_closing_balance, lowest_balance_30d, overdraft_days_30d, returned_debit_count,
         minimum_expense_norm, affordability_surplus, nca_nett_income
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
       RETURNING id`,
      [
        s.userId, s.periodStart, s.periodEnd, s.periodMonths, s.ingestionSource,
        s.grossIncome, s.netIncome, s.incomeStreams, s.incomeRegularityScore, s.unclassifiedCredits,
        s.housingExpenses, s.transportExpenses, s.foodExpenses, s.utilitiesExpenses,
        s.insuranceExpenses, s.debtRepaymentTotal, s.entertainmentExpenses, s.gamblingSpend,
        s.debtToIncomeRatio, s.savingsRate,
        s.averageClosingBalance, s.lowestBalance30d, s.overdraftDays30d, s.returnedDebitCount,
        s.minimumExpenseNorm, s.affordabilitySurplus, s.ncaNettIncome,
      ]
    );
    const snapshotId = ins.rows[0]!.id;

    const ids = s.transactions.map((t) => t.providerTransactionId).filter((id): id is string => id !== null);
    const existing = new Set(
      ids.length === 0
        ? []
        : (
            await client.query<{ provider_transaction_id: string }>(
              'SELECT provider_transaction_id FROM credisync.transactions WHERE user_id = $1 AND provider_transaction_id = ANY($2::text[])',
              [s.userId, ids]
            )
          ).rows.map((r) => r.provider_transaction_id)
    );
    const fresh = s.transactions.filter((t) => !t.providerTransactionId || !existing.has(t.providerTransactionId));

    for (let i = 0; i < fresh.length; i += BATCH_SIZE) {
      const batch = fresh.slice(i, i + BATCH_SIZE);
      const values: unknown[] = [];
      const rows = batch.map((t, j) => {
        const o = j * 12;
        values.push(
          snapshotId, s.userId, t.providerTransactionId, t.transactionDate, t.postedDate, t.amount,
          t.currency, t.description, t.category, t.isRecurring, t.merchantName, t.reference
        );
        return `($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6},$${o + 7},$${o + 8},$${o + 9},$${o + 10},$${o + 11},$${o + 12})`;
      });
      await client.query(
        `INSERT INTO credisync.transactions (
           snapshot_id, user_id, provider_transaction_id, transaction_date, posted_date, amount,
           currency, description, category, is_recurring, merchant_name, reference
         ) VALUES ${rows.join(',')}`,
        values
      );
    }

    await writeAudit(client, {
      userId: s.userId,
      eventType: 'bank_data_ingested',
      resourceType: 'financial_health_snapshot',
      resourceId: snapshotId,
      payload: { source: s.ingestionSource, transaction_count: fresh.length, skipped_duplicates: s.transactions.length - fresh.length },
    });
    return { snapshotId, inserted: fresh.length };
  });
}

export async function latestSnapshot(pool: Pool, userId: string) {
  return withUser(pool, userId, async (client) => {
    const r = await client.query(
      'SELECT * FROM credisync.financial_health_snapshots WHERE user_id = $1 ORDER BY period_end DESC, created_at DESC LIMIT 1',
      [userId]
    );
    return r.rows[0] ?? null;
  });
}
