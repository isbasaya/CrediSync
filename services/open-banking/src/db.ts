import type { Pool, PoolClient } from 'pg';
import { withUser, writeAudit, enqueueEvent } from '@credisync/db';
import { decryptFromBytes, encryptToBytes, sha256Hex } from '@credisync/crypto';
import type { FinancialHealthSnapshot, IngestionSource } from './types';

export class OpenBankingError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'OpenBankingError';
  }
}

async function assertConsent(client: PoolClient, userId: string): Promise<void> {
  const r = await client.query<{ open_banking_consent: boolean }>(
    'SELECT open_banking_consent FROM credisync.users WHERE id = $1 AND is_active',
    [userId],
  );
  if (!r.rows[0]?.open_banking_consent) {
    throw new OpenBankingError(
      403,
      'open_banking_consent_required',
      'Give permission to read your bank transactions first',
    );
  }
}

/** Stores the provider token from the consent/link flow, encrypted. The token is never returned to clients. */
export interface StoredTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
}

async function sealTokens(tokens: StoredTokens): Promise<Buffer> {
  return encryptToBytes(
    JSON.stringify({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken }),
  );
}

/**
 * Stores provider tokens from the consent flow, encrypted. Tokens are never
 * returned to clients. Requires open-banking consent at the moment of linking.
 */
export async function createLink(
  pool: Pool,
  userId: string,
  source: IngestionSource,
  tokens: StoredTokens,
) {
  return withUser(pool, userId, async (client) => {
    await assertConsent(client, userId);
    const r = await client.query<{ id: string; created_at: Date }>(
      `INSERT INTO credisync.open_banking_links (user_id, source, token_encrypted, token_expires_at)
       VALUES ($1, $2, $3, $4) RETURNING id, created_at`,
      [userId, source, await sealTokens(tokens), tokens.expiresAt],
    );
    await writeAudit(client, {
      userId,
      eventType: 'bank_link_created',
      resourceType: 'open_banking_link',
      resourceId: r.rows[0]!.id,
      payload: { source },
    });
    await enqueueEvent(client, {
      type: 'open_banking.linked',
      aggregateType: 'open_banking_link',
      aggregateId: r.rows[0]!.id,
      userId,
      payload: { source },
    });
    return { id: r.rows[0]!.id, source, createdAt: r.rows[0]!.created_at.toISOString() };
  });
}

/** Replaces a link's tokens after a refresh (Stitch rotates refresh tokens on every use). */
export async function saveLinkTokens(
  pool: Pool,
  userId: string,
  linkId: string,
  tokens: StoredTokens,
): Promise<void> {
  const sealed = await sealTokens(tokens);
  await withUser(pool, userId, (client) =>
    client.query(
      `UPDATE credisync.open_banking_links
       SET token_encrypted = $2, token_expires_at = $3, last_refreshed_at = NOW()
       WHERE id = $1 AND revoked_at IS NULL`,
      [linkId, sealed, tokens.expiresAt],
    ),
  );
}

const STATE_TTL_MINUTES = 10;

/** Records the PKCE verifier and nonce for one consent redirect, keyed by a hash of `state`. */
export async function createLinkState(
  pool: Pool,
  userId: string,
  source: IngestionSource,
  request: { state: string; codeVerifier: string; nonce: string },
): Promise<void> {
  await withUser(pool, userId, async (client) => {
    await assertConsent(client, userId);
    await client.query(
      `INSERT INTO credisync.oauth_link_states (state_hash, user_id, provider, code_verifier_encrypted, nonce, expires_at)
       VALUES ($1, $2, $3, $4, $5, NOW() + make_interval(mins => $6))`,
      [
        sha256Hex(request.state),
        userId,
        source,
        await encryptToBytes(request.codeVerifier),
        request.nonce,
        STATE_TTL_MINUTES,
      ],
    );
  });
}

/**
 * Consumes a state exactly once. Fails if it is unknown, expired, already
 * used, or belongs to a different user (RLS makes another user's state
 * invisible) — the CSRF protection for the redirect.
 */
export async function consumeLinkState(
  pool: Pool,
  userId: string,
  state: string,
): Promise<{ source: IngestionSource; codeVerifier: string }> {
  const row = await withUser(pool, userId, async (client) => {
    const r = await client.query(
      `UPDATE credisync.oauth_link_states SET used_at = NOW()
       WHERE state_hash = $1 AND used_at IS NULL AND expires_at > NOW()
       RETURNING provider, code_verifier_encrypted`,
      [sha256Hex(state)],
    );
    return r.rows[0];
  });
  if (!row)
    throw new OpenBankingError(
      400,
      'invalid_state',
      'This bank connection attempt expired. Please start again.',
    );
  return {
    source: row.provider,
    codeVerifier: await decryptFromBytes(row.code_verifier_encrypted),
  };
}

export async function listLinks(pool: Pool, userId: string) {
  return withUser(pool, userId, async (client) => {
    const r = await client.query(
      'SELECT id, source, created_at, revoked_at FROM credisync.open_banking_links WHERE user_id = $1 ORDER BY created_at DESC',
      [userId],
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
      [linkId],
    );
    if (!r.rowCount) throw new OpenBankingError(404, 'not_found', 'Bank link not found');
  });
}

/** Re-checks consent and decrypts the provider token for one ingest. */
/** Re-checks consent and decrypts the provider tokens for one ingest. */
export async function loadLinkToken(
  pool: Pool,
  userId: string,
  linkId: string,
): Promise<{ source: IngestionSource } & StoredTokens> {
  const row = await withUser(pool, userId, async (client) => {
    await assertConsent(client, userId);
    const r = await client.query(
      'SELECT source, token_encrypted, token_expires_at, revoked_at FROM credisync.open_banking_links WHERE id = $1',
      [linkId],
    );
    return r.rows[0];
  });
  if (!row) throw new OpenBankingError(404, 'not_found', 'Bank link not found');
  if (row.revoked_at || !row.token_encrypted)
    throw new OpenBankingError(
      409,
      'link_revoked',
      'This bank link was disconnected. Link your account again.',
    );
  const plain = await decryptFromBytes(row.token_encrypted);
  // Older links stored the bare access token; newer ones store JSON.
  const parsed = plain.startsWith('{')
    ? (JSON.parse(plain) as { accessToken: string; refreshToken: string | null })
    : { accessToken: plain, refreshToken: null };
  return {
    source: row.source,
    accessToken: parsed.accessToken,
    refreshToken: parsed.refreshToken,
    expiresAt: row.token_expires_at ? new Date(row.token_expires_at) : null,
  };
}

/** Marks a link unusable (e.g. the provider rejected its refresh token). */
export async function expireLink(pool: Pool, userId: string, linkId: string): Promise<void> {
  await withUser(pool, userId, (client) =>
    client.query(
      'UPDATE credisync.open_banking_links SET token_encrypted = NULL, revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL',
      [linkId],
    ),
  );
}

const BATCH_SIZE = 500;

/**
 * Persists a snapshot and its transactions in one transaction. Transactions
 * already stored for this user (same provider id) are skipped, so
 * overlapping ingest periods never double-count.
 */
export async function persistSnapshot(
  pool: Pool,
  snapshot: FinancialHealthSnapshot,
): Promise<{ snapshotId: string; inserted: number }> {
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
        s.userId,
        s.periodStart,
        s.periodEnd,
        s.periodMonths,
        s.ingestionSource,
        s.grossIncome,
        s.netIncome,
        s.incomeStreams,
        s.incomeRegularityScore,
        s.unclassifiedCredits,
        s.housingExpenses,
        s.transportExpenses,
        s.foodExpenses,
        s.utilitiesExpenses,
        s.insuranceExpenses,
        s.debtRepaymentTotal,
        s.entertainmentExpenses,
        s.gamblingSpend,
        s.debtToIncomeRatio,
        s.savingsRate,
        s.averageClosingBalance,
        s.lowestBalance30d,
        s.overdraftDays30d,
        s.returnedDebitCount,
        s.minimumExpenseNorm,
        s.affordabilitySurplus,
        s.ncaNettIncome,
      ],
    );
    const snapshotId = ins.rows[0]!.id;

    const ids = s.transactions
      .map((t) => t.providerTransactionId)
      .filter((id): id is string => id !== null);
    const existing = new Set(
      ids.length === 0
        ? []
        : (
            await client.query<{ provider_transaction_id: string }>(
              'SELECT provider_transaction_id FROM credisync.transactions WHERE user_id = $1 AND provider_transaction_id = ANY($2::text[])',
              [s.userId, ids],
            )
          ).rows.map((r) => r.provider_transaction_id),
    );
    const fresh = s.transactions.filter(
      (t) => !t.providerTransactionId || !existing.has(t.providerTransactionId),
    );

    for (let i = 0; i < fresh.length; i += BATCH_SIZE) {
      const batch = fresh.slice(i, i + BATCH_SIZE);
      const values: unknown[] = [];
      const rows = batch.map((t, j) => {
        const o = j * 12;
        values.push(
          snapshotId,
          s.userId,
          t.providerTransactionId,
          t.transactionDate,
          t.postedDate,
          t.amount,
          t.currency,
          t.description,
          t.category,
          t.isRecurring,
          t.merchantName,
          t.reference,
        );
        return `($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6},$${o + 7},$${o + 8},$${o + 9},$${o + 10},$${o + 11},$${o + 12})`;
      });
      await client.query(
        `INSERT INTO credisync.transactions (
           snapshot_id, user_id, provider_transaction_id, transaction_date, posted_date, amount,
           currency, description, category, is_recurring, merchant_name, reference
         ) VALUES ${rows.join(',')}`,
        values,
      );
    }

    await writeAudit(client, {
      userId: s.userId,
      eventType: 'bank_data_ingested',
      resourceType: 'financial_health_snapshot',
      resourceId: snapshotId,
      payload: {
        source: s.ingestionSource,
        transaction_count: fresh.length,
        skipped_duplicates: s.transactions.length - fresh.length,
      },
    });
    await enqueueEvent(client, {
      type: 'open_banking.snapshot_created',
      aggregateType: 'financial_health_snapshot',
      aggregateId: snapshotId,
      userId: s.userId,
    });
    return { snapshotId, inserted: fresh.length };
  });
}

export async function latestSnapshot(pool: Pool, userId: string) {
  return withUser(pool, userId, async (client) => {
    const r = await client.query(
      'SELECT * FROM credisync.financial_health_snapshots WHERE user_id = $1 ORDER BY period_end DESC, created_at DESC LIMIT 1',
      [userId],
    );
    return r.rows[0] ?? null;
  });
}
