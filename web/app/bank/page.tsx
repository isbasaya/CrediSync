'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { Button, Notice, PageShell } from '@/components/ui';
import {
  describeError,
  disconnectBankLink,
  ingestBankData,
  listBankLinks,
  scoreBankReadiness,
  startBankLink,
  updateConsents,
  type BankLink,
  type IngestResult,
} from '@/lib/api-client';
import { RequireSession, useSession } from '@/lib/session';

const currency = new Intl.NumberFormat('en-ZA', {
  style: 'currency',
  currency: 'ZAR',
  maximumFractionDigits: 0,
});
const dateLabel = (iso: string) =>
  new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });

/** The last three complete calendar months, e.g. 1 Jul – 30 Sep when run in October. */
function lastThreeMonths(today = new Date()): { start: string; end: string } {
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 2, 1));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function Bank() {
  const { me, reload } = useSession();
  const params = useSearchParams();
  const [links, setLinks] = useState<BankLink[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IngestResult | null>(null);
  const [readiness, setReadiness] = useState<{
    score: number;
    tier: string;
    top_reasons: string[];
  } | null>(null);

  const load = useCallback(async () => {
    try {
      setLinks((await listBankLinks()).links);
    } catch (err) {
      setError(describeError(err, 'We couldn’t load your bank connections.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(describeError(err, 'Something went wrong.'));
    } finally {
      setBusy(null);
    }
  };

  if (!me) return null;
  const active = (links ?? []).filter((l) => !l.revokedAt);
  const period = lastThreeMonths();

  return (
    <PageShell
      title="Bank account"
      intro="Connect your bank account to see your real monthly income and spending, and how ready you are for credit. We only read transactions — we can’t move money."
    >
      {params.get('linked') && <Notice tone="success">Your bank account is connected.</Notice>}
      {error && <Notice tone="error">{error}</Notice>}

      {!me.consents.openBanking ? (
        <section className="flex flex-col items-start gap-3 rounded-2xl border border-border-default bg-bg-surface p-6">
          <h2 className="text-sm font-semibold text-text-primary">Permission needed</h2>
          <p className="text-sm text-text-secondary">
            To read your transactions we need your permission under the Protection of Personal
            Information Act. We use them only to work out affordability and bank readiness, and you
            can withdraw permission at any time (which disconnects your bank).
          </p>
          <Button
            busy={busy === 'consent'}
            onClick={() =>
              run('consent', async () => {
                await updateConsents({ openBanking: true });
                await reload();
              })
            }
          >
            Allow CrediSync to read my transactions
          </Button>
        </section>
      ) : (
        <section
          className="flex flex-col gap-4 rounded-2xl border border-border-default bg-bg-surface p-6"
          aria-labelledby="connections"
        >
          <h2 id="connections" className="text-sm font-semibold text-text-primary">
            Connections
          </h2>
          {links === null && (
            <div
              className="h-12 animate-pulse rounded-lg bg-bg-muted"
              role="status"
              aria-label="Loading connections"
            />
          )}
          {links !== null && active.length === 0 && (
            <p className="text-sm text-text-secondary">No bank account connected yet.</p>
          )}
          {active.map((link) => (
            <div
              key={link.id}
              className="flex flex-col gap-3 border-t border-border-subtle pt-4 first:border-t-0 first:pt-0 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <div className="text-sm font-medium text-text-primary">Connected via Stitch</div>
                <div className="text-xs text-text-muted">Since {dateLabel(link.createdAt)}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  busy={busy === `ingest-${link.id}`}
                  onClick={() =>
                    run(`ingest-${link.id}`, async () => {
                      setResult(await ingestBankData(link.id, period.start, period.end));
                    })
                  }
                >
                  Analyse last 3 months
                </Button>
                <Button
                  variant="secondary"
                  busy={busy === `disconnect-${link.id}`}
                  onClick={() =>
                    run(`disconnect-${link.id}`, async () => {
                      await disconnectBankLink(link.id);
                      await load();
                    })
                  }
                >
                  Disconnect
                </Button>
              </div>
            </div>
          ))}
          <Button
            variant={active.length > 0 ? 'secondary' : 'primary'}
            busy={busy === 'connect'}
            onClick={() =>
              run('connect', async () => {
                const { authorizationUrl } = await startBankLink();
                window.location.assign(authorizationUrl);
              })
            }
          >
            {active.length > 0 ? 'Connect another account' : 'Connect my bank account'}
          </Button>
        </section>
      )}

      {result && (
        <section
          className="flex flex-col gap-4 rounded-2xl border border-border-default bg-bg-surface p-6"
          aria-labelledby="monthly"
        >
          <h2 id="monthly" className="text-sm font-semibold text-text-primary">
            Your monthly picture ({dateLabel(period.start)} – {dateLabel(period.end)})
          </h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
            <div>
              <dt className="text-sm text-text-muted">Income</dt>
              <dd className="font-mono text-base font-semibold tabular-nums text-text-primary">
                {currency.format(result.monthlyNetIncome)}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-text-muted">Left over after costs</dt>
              <dd className="font-mono text-base font-semibold tabular-nums text-text-primary">
                {result.monthlyAffordabilitySurplus === null
                  ? '—'
                  : currency.format(result.monthlyAffordabilitySurplus)}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-text-muted">Debt repayments vs income</dt>
              <dd className="font-mono text-base font-semibold tabular-nums text-text-primary">
                {result.debtToIncomeRatio === null
                  ? '—'
                  : `${Math.round(result.debtToIncomeRatio * 100)}%`}
              </dd>
            </div>
          </dl>
          <p className="text-xs text-text-muted">
            Only regular earnings (salary, grants, pension) count as income. Living costs are at
            least the National Credit Act minimum for your income.
          </p>
          <Button
            variant="secondary"
            busy={busy === 'readiness'}
            onClick={() => run('readiness', async () => setReadiness(await scoreBankReadiness()))}
          >
            Update my bank readiness
          </Button>
          {readiness && (
            <Notice>
              Bank readiness: <strong>{Math.round(readiness.score)}/100</strong> (
              {readiness.tier.replace('_', '-')}).{' '}
              {readiness.top_reasons.length > 0 && (
                <>Main factors: {readiness.top_reasons.join('; ')}.</>
              )}
            </Notice>
          )}
        </section>
      )}
    </PageShell>
  );
}

export default function BankPage() {
  return (
    <>
      <AppHeader />
      <RequireSession>
        <Suspense>
          <Bank />
        </Suspense>
      </RequireSession>
    </>
  );
}
