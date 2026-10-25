import { Pool } from 'pg';
import type { FinancialHealthSnapshot } from './types';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
});

/** Persists a snapshot + its transactions inside one transaction. */
export async function persistSnapshot(snapshot: FinancialHealthSnapshot): Promise<string> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL app.current_user_id = $1', [snapshot.userId]);

    const insertSnapshot = await client.query<{ id: string }>(
      `INSERT INTO credisync.financial_health_snapshots (
         user_id, period_start, period_end, ingestion_source,
         gross_income, net_income, income_streams, income_regularity_score,
         housing_expenses, transport_expenses, food_expenses, utilities_expenses,
         insurance_expenses, debt_repayment_total, entertainment_expenses, gambling_spend,
         debt_to_income_ratio, savings_rate,
         average_closing_balance, lowest_balance_30d, overdraft_days_30d, returned_debit_count,
         affordability_surplus, nca_nett_income
       ) VALUES (
         $1,$2,$3,$4, $5,$6,$7,$8, $9,$10,$11,$12, $13,$14,$15,$16,
         $17,$18, $19,$20,$21,$22, $23,$24
       ) RETURNING id`,
      [
        snapshot.userId,
        snapshot.periodStart,
        snapshot.periodEnd,
        snapshot.ingestionSource,
        snapshot.grossIncome,
        snapshot.netIncome,
        snapshot.incomeStreams,
        snapshot.incomeRegularityScore,
        snapshot.housingExpenses,
        snapshot.transportExpenses,
        snapshot.foodExpenses,
        snapshot.utilitiesExpenses,
        snapshot.insuranceExpenses,
        snapshot.debtRepaymentTotal,
        snapshot.entertainmentExpenses,
        snapshot.gamblingSpend,
        snapshot.debtToIncomeRatio,
        snapshot.savingsRate,
        snapshot.averageClosingBalance,
        snapshot.lowestBalance30d,
        snapshot.overdraftDays30d,
        snapshot.returnedDebitCount,
        snapshot.affordabilitySurplus,
        snapshot.ncaNettIncome,
      ]
    );

    const snapshotId = insertSnapshot.rows[0]!.id;

    for (const t of snapshot.transactions) {
      await client.query(
        `INSERT INTO credisync.transactions (
           snapshot_id, user_id, transaction_date, posted_date, amount, currency,
           description, category, is_recurring, merchant_name, reference
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          snapshotId,
          snapshot.userId,
          t.transactionDate,
          t.postedDate,
          t.amount,
          t.currency,
          t.description,
          t.category,
          t.isRecurring,
          t.merchantName,
          t.reference,
        ]
      );
    }

    await client.query(
      `INSERT INTO credisync.regulatory_audit_logs (user_id, event_type, resource_type, resource_id, payload)
       VALUES ($1, 'bank_data_ingested', 'financial_health_snapshot', $2, $3::jsonb)`,
      [snapshot.userId, snapshotId, JSON.stringify({ source: snapshot.ingestionSource, transaction_count: snapshot.transactions.length })]
    );

    await client.query('COMMIT');
    return snapshotId;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
