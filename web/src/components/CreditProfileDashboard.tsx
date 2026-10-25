'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ApiError,
  describeError,
  getBureauAccounts,
  getCreditProfile,
  refreshCreditProfile,
} from '../lib/api-client';
import { useSession } from '../lib/session';
import { BUREAU_LABELS, type BureauAccountSummary, type CreditProfileSummary } from '../lib/types';
import { ScoreHero } from './ScoreHero';
import { BureauComparisonBars } from './BureauComparisonBars';
import { AccountStatusBadge } from './AccountStatusBadge';
import { AlertTriangleIcon, GavelIcon, RefreshIcon } from './icons';
import { Button, Notice } from './ui';

const currencyFormatter = new Intl.NumberFormat('en-ZA', {
  style: 'currency',
  currency: 'ZAR',
  maximumFractionDigits: 0,
});

const READINESS_TIER_LABEL: Record<
  NonNullable<CreditProfileSummary['bankReadinessTier']>,
  string
> = {
  prime: 'Prime',
  near_prime: 'Near-prime',
  sub_prime: 'Sub-prime',
  unqualified: 'Unqualified',
};

// Rank accounts by severity so the eye lands on the problem first.
const SEVERITY: Record<BureauAccountSummary['status'], number> = {
  judgement: 0,
  default: 1,
  written_off: 2,
  arrears: 3,
  unknown: 4,
  current: 5,
};

function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-bg-muted ${className}`} />;
}

function DashboardSkeleton() {
  return (
    <div
      className="mx-auto flex max-w-4xl flex-col gap-6 p-4 sm:p-6"
      role="status"
      aria-live="polite"
    >
      <span className="sr-only">Loading your credit profile</span>
      <SkeletonBlock className="h-52 rounded-2xl" />
      <SkeletonBlock className="h-32 rounded-2xl" />
      <SkeletonBlock className="h-64 rounded-2xl" />
    </div>
  );
}

/** A figure set apart by size alone — reserved for facts that change what someone does next. */
function LeadFigure({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="font-mono text-4xl font-bold tabular-nums leading-none text-status-judgement-fg">
        {value}
      </div>
      <div className="mt-2 text-sm font-medium text-text-secondary">{label}</div>
    </div>
  );
}

function QuietFigure({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col items-start gap-0.5">
      <span className="text-sm text-text-muted">{label}</span>
      <span className="font-mono text-base font-semibold tabular-nums text-text-primary">
        {value}
      </span>
    </div>
  );
}

function bureausFor(account: BureauAccountSummary): string {
  return account.reportedBy.map((r) => BUREAU_LABELS[r.bureau]).join(', ');
}

/** What to show when there is no profile yet: a single next step, worded for the reason. */
function FirstRun({
  onRefresh,
  refreshing,
  error,
}: {
  onRefresh: () => void;
  refreshing: boolean;
  error: string | null;
}) {
  const { me } = useSession();
  const blocked = !me?.is_verified ? 'verify' : !me?.consents.creditCheck ? 'consent' : null;
  return (
    <div className="mx-auto flex max-w-xl flex-col items-start gap-4 px-4 py-12 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-text-primary">
        Let’s fetch your credit reports
      </h1>
      <p className="text-sm text-text-secondary">
        We’ll request your reports from TransUnion, Experian and XDS, match up accounts that appear
        at more than one bureau, and show you one combined view. Checking your own reports doesn’t
        affect your score.
      </p>
      {error && <Notice tone="error">{error}</Notice>}
      {blocked === 'verify' && (
        <Notice>Confirm your email address first — check your inbox for the link we sent.</Notice>
      )}
      {blocked === 'consent' && (
        <Notice>
          You haven’t given permission to request your reports.{' '}
          <Link href="/privacy" className="font-semibold text-teal-700 underline">
            Update your permissions
          </Link>
          .
        </Notice>
      )}
      <Button onClick={onRefresh} busy={refreshing} disabled={blocked !== null}>
        <RefreshIcon className="h-4 w-4" />
        Fetch my reports
      </Button>
    </div>
  );
}

export function CreditProfileDashboard() {
  const [profile, setProfile] = useState<CreditProfileSummary | null>(null);
  const [accounts, setAccounts] = useState<BureauAccountSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [nextProfile, nextAccounts] = await Promise.all([
        getCreditProfile(),
        getBureauAccounts(),
      ]);
      setProfile(nextProfile);
      setAccounts(nextAccounts);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'no_credit_profile') setProfile(null);
      else setError(describeError(err, 'We couldn’t load your credit profile.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleRefresh() {
    setRefreshing(true);
    setError(null);
    setNotice(null);
    try {
      const result = await refreshCreditProfile();
      setProfile(result.profile);
      setAccounts(await getBureauAccounts());
      if (result.bureauFailures.length > 0) {
        setNotice(
          `${result.bureauFailures.map((f) => BUREAU_LABELS[f.bureau]).join(' and ')} didn’t respond this time. We used the bureaus that did; try again later for a complete picture.`,
        );
      }
    } catch (err) {
      setError(describeError(err, 'We couldn’t refresh your reports from the bureaus.'));
    } finally {
      setRefreshing(false);
    }
  }

  if (loading) return <DashboardSkeleton />;
  if (!profile) return <FirstRun onRefresh={handleRefresh} refreshing={refreshing} error={error} />;

  const hasSeverePriority = profile.adverseAccounts > 0 || profile.judgementsCount > 0;
  const routineStats: Array<{ label: string; value: string | number }> = [
    { label: 'Accounts', value: profile.totalAccounts },
    { label: 'Open accounts', value: profile.openAccounts },
    { label: 'Enquiries (12m)', value: profile.enquiriesLast12m },
    { label: 'Total owed', value: currencyFormatter.format(profile.totalCreditExposure) },
    { label: 'Monthly repayments', value: currencyFormatter.format(profile.monthlyInstalment) },
    {
      label: 'Bank readiness',
      value:
        profile.bankReadinessScore !== null && profile.bankReadinessTier
          ? `${profile.bankReadinessScore.toFixed(0)}/100 · ${READINESS_TIER_LABEL[profile.bankReadinessTier]}`
          : '—',
    },
  ];
  const rankedAccounts = [...accounts].sort((a, b) => SEVERITY[a.status] - SEVERITY[b.status]);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-4 sm:p-6">
      {error && <Notice tone="error">{error}</Notice>}
      {notice && <Notice>{notice}</Notice>}

      <ScoreHero
        score={profile.unifiedScore}
        band={profile.unifiedScoreBand}
        bureauScores={profile.bureauScores}
        lastRefreshedAt={profile.lastRefreshedAt}
        refreshing={refreshing}
        onRefresh={handleRefresh}
      />

      <section
        className="animate-fade-in rounded-2xl border border-border-default bg-bg-surface p-6 shadow-sm"
        aria-labelledby="by-bureau"
      >
        <h2 id="by-bureau" className="mb-4 text-sm font-semibold text-text-primary">
          Score by bureau
        </h2>
        <BureauComparisonBars scores={profile.bureauScores} />
      </section>

      <section
        className="animate-fade-in rounded-2xl border border-border-default bg-bg-surface p-6 shadow-sm"
        aria-label="Summary"
      >
        <div className="flex flex-col gap-6 sm:flex-row sm:gap-10">
          {hasSeverePriority && (
            <div className="flex shrink-0 gap-8 border-b border-border-subtle pb-6 sm:border-b-0 sm:border-r sm:pb-0 sm:pr-10">
              {profile.judgementsCount > 0 && (
                <LeadFigure label="Judgements" value={profile.judgementsCount} />
              )}
              {profile.adverseAccounts > 0 && (
                <LeadFigure label="Adverse accounts" value={profile.adverseAccounts} />
              )}
            </div>
          )}
          <div className="grid flex-1 grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
            {routineStats.map((stat) => (
              <QuietFigure key={stat.label} label={stat.label} value={stat.value} />
            ))}
          </div>
        </div>
      </section>

      {hasSeverePriority && (
        <div className="flex animate-fade-in items-start gap-3 rounded-2xl border border-status-judgement-fg/25 bg-status-judgement-bg/60 p-4 text-sm text-text-secondary">
          <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-status-judgement-fg" />
          <p>
            Your profile has {profile.adverseAccounts} adverse account
            {profile.adverseAccounts === 1 ? '' : 's'}
            {profile.judgementsCount > 0 &&
              ` and ${profile.judgementsCount} judgement${profile.judgementsCount === 1 ? '' : 's'}`}
            . If anything below looks wrong, you can dispute it with the bureau for free.
          </p>
        </div>
      )}

      <section
        className="animate-fade-in rounded-2xl border border-border-default bg-bg-surface p-6 shadow-sm"
        aria-labelledby="accounts"
      >
        <h2 id="accounts" className="mb-1 text-sm font-semibold text-text-primary">
          Accounts
        </h2>
        <p className="mb-4 text-xs text-text-muted">
          Each line is one account. Where more than one bureau reports it, we show the most cautious
          figures.
        </p>
        {rankedAccounts.length === 0 ? (
          <p className="py-8 text-center text-sm text-text-muted">No accounts on file.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border-subtle">
            {rankedAccounts.map((account) => {
              const urgent = SEVERITY[account.status] <= 1;
              return (
                <li
                  key={account.resolvedAccountId}
                  className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
                >
                  <div className="min-w-0">
                    <div
                      className={`text-text-primary ${urgent ? 'text-base font-semibold' : 'text-sm font-medium'}`}
                    >
                      {account.creditorName}
                    </div>
                    <div className="text-xs text-text-muted">
                      {account.accountType.replace(/_/g, ' ')} · reported by {bureausFor(account)}
                    </div>
                  </div>
                  <div className="flex items-center gap-4 sm:shrink-0">
                    <span className="font-mono text-sm tabular-nums text-text-secondary">
                      {currencyFormatter.format(account.currentBalance)}
                    </span>
                    <AccountStatusBadge status={account.status} />
                    <Link
                      href={`/disputes/new?account=${account.resolvedAccountId}`}
                      className={`inline-flex items-center gap-1.5 text-sm font-semibold ${urgent ? 'text-teal-700 hover:text-teal-800' : 'text-text-muted hover:text-teal-800'}`}
                      aria-label={`Dispute ${account.creditorName}`}
                    >
                      <GavelIcon className="h-3.5 w-3.5" />
                      Dispute
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
