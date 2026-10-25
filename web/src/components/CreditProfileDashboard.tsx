'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ApiError, getBureauAccounts, getCreditProfile, refreshCreditProfile } from '../lib/api-client';
import type { BureauAccountSummary, CreditProfileSummary } from '../lib/types';
import { ScoreHero } from './ScoreHero';
import { BureauComparisonBars } from './BureauComparisonBars';
import { AccountStatusBadge } from './AccountStatusBadge';
import { AlertTriangleIcon, GavelIcon } from './icons';

const currencyFormatter = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 });

const READINESS_TIER_LABEL: Record<NonNullable<CreditProfileSummary['bankReadinessTier']>, string> = {
  prime: 'Prime',
  near_prime: 'Near-prime',
  sub_prime: 'Sub-prime',
  unqualified: 'Unqualified',
};

/** A caught error names the problem in plain terms, never a raw network exception. */
function describeError(err: unknown, action: string): string {
  if (err instanceof ApiError) {
    return err.message || `We couldn't ${action} right now.`;
  }
  return `We couldn't ${action} — check your connection and try again.`;
}

function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-bg-muted ${className}`} />;
}

function DashboardSkeleton() {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-4 sm:p-6">
      <SkeletonBlock className="h-52 rounded-2xl" />
      <SkeletonBlock className="h-32 rounded-2xl" />
      <SkeletonBlock className="h-64 rounded-2xl" />
    </div>
  );
}

/**
 * A figure the reader's eye should catch before it catches anything else
 * on the page — set apart by size alone, no card chrome. Reserved for the
 * one or two facts that actually change what someone does next.
 */
function LeadFigure({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="font-mono text-4xl font-bold tabular-nums leading-none text-status-judgement-fg">{value}</div>
      <div className="mt-2 text-sm font-medium text-text-secondary">{label}</div>
    </div>
  );
}

/** Routine figures recede into a quiet, dense list — no icon tile, no border. */
function QuietFigure({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col items-start gap-0.5">
      <span className="text-sm text-text-muted">{label}</span>
      <span className="font-mono text-base font-semibold tabular-nums text-text-primary">{value}</span>
    </div>
  );
}

export function CreditProfileDashboard({ userId }: { userId: string }) {
  const [profile, setProfile] = useState<CreditProfileSummary | null>(null);
  const [accounts, setAccounts] = useState<BureauAccountSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const nextProfile = await getCreditProfile(userId);
      setProfile(nextProfile);
      setAccounts(await getBureauAccounts(nextProfile.id));
    } catch (err) {
      setError(describeError(err, 'load your credit profile'));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const nextProfile = await refreshCreditProfile(userId);
      setProfile(nextProfile);
      setAccounts(await getBureauAccounts(nextProfile.id));
    } catch (err) {
      setError(describeError(err, 'refresh your credit profile from the bureaus'));
    } finally {
      setRefreshing(false);
    }
  }

  if (loading) {
    return <DashboardSkeleton />;
  }

  if (error || !profile) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-2xl border border-border-default bg-bg-surface p-8 text-center shadow-sm">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-status-very-poor-bg text-status-very-poor-fg">
          <AlertTriangleIcon className="h-5 w-5" />
        </span>
        <p className="text-sm text-text-secondary">{error ?? 'No credit profile found.'}</p>
        <button
          onClick={load}
          className="cursor-pointer rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-white transition-colors duration-normal hover:bg-brand-hover"
        >
          Try again
        </button>
      </div>
    );
  }

  const hasSeverePriority = profile.adverseAccounts > 0 || profile.judgementsCount > 0;
  const routineStats: Array<{ label: string; value: string | number }> = [
    { label: 'Total accounts', value: profile.totalAccounts },
    { label: 'Open accounts', value: profile.openAccounts },
    { label: 'Enquiries (12m)', value: profile.enquiriesLast12m },
    { label: 'Total exposure', value: currencyFormatter.format(profile.totalCreditExposure) },
    { label: 'Bank readiness', value: profile.bankReadinessScore !== null ? `${profile.bankReadinessScore.toFixed(0)}/100` : '—' },
    { label: 'Readiness tier', value: profile.bankReadinessTier ? READINESS_TIER_LABEL[profile.bankReadinessTier] : '—' },
  ];

  // Rank accounts by severity so the eye lands on the problem first —
  // depth as priority, not a uniform list every row competes evenly in.
  const severityRank: Record<BureauAccountSummary['status'], number> = {
    judgement: 0,
    default: 1,
    arrears: 2,
    current: 3,
    written_off: 4,
  };
  const rankedAccounts = [...accounts].sort((a, b) => severityRank[a.status] - severityRank[b.status]);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-4 sm:p-6">
      <ScoreHero
        score={profile.unifiedScore}
        band={profile.unifiedScoreBand}
        bureauScores={profile.bureauScores}
        lastRefreshedAt={profile.lastRefreshedAt}
        refreshing={refreshing}
        onRefresh={handleRefresh}
      />

      <div className="animate-fade-in rounded-2xl border border-border-default bg-bg-surface p-6 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold text-text-primary">Score by bureau</h2>
        <BureauComparisonBars scores={profile.bureauScores} />
      </div>

      <div className="animate-fade-in rounded-2xl border border-border-default bg-bg-surface p-6 shadow-sm">
        <div className="flex flex-col gap-6 sm:flex-row sm:gap-10">
          {hasSeverePriority && (
            <div className="flex shrink-0 gap-8 border-b border-border-subtle pb-6 sm:border-b-0 sm:border-r sm:pb-0 sm:pr-10">
              {profile.judgementsCount > 0 && <LeadFigure label="Judgements" value={profile.judgementsCount} />}
              {profile.adverseAccounts > 0 && <LeadFigure label="Adverse accounts" value={profile.adverseAccounts} />}
            </div>
          )}
          <div className="grid flex-1 grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
            {routineStats.map((stat) => (
              <QuietFigure key={stat.label} label={stat.label} value={stat.value} />
            ))}
          </div>
        </div>
      </div>

      {hasSeverePriority && (
        <div className="flex animate-fade-in items-start gap-3 rounded-2xl border border-status-judgement-fg/25 bg-status-judgement-bg/60 p-4 text-sm text-text-secondary">
          <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-status-judgement-fg" />
          <p>
            Your profile has {profile.adverseAccounts} adverse account{profile.adverseAccounts === 1 ? '' : 's'}
            {profile.judgementsCount > 0 && ` and ${profile.judgementsCount} judgement${profile.judgementsCount === 1 ? '' : 's'}`}.
            Review the accounts below and consider filing a dispute if any look incorrect.
          </p>
        </div>
      )}

      <div className="animate-fade-in rounded-2xl border border-border-default bg-bg-surface p-6 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold text-text-primary">Accounts</h2>
        {rankedAccounts.length === 0 ? (
          <p className="py-8 text-center text-sm text-text-muted">No accounts on file.</p>
        ) : (
          <>
            {/* Desktop table */}
            <table className="hidden w-full text-sm sm:table">
              <thead>
                <tr className="border-b border-border-subtle text-left text-xs font-medium uppercase tracking-wide text-text-muted">
                  <th className="py-2 pr-4 font-medium">Creditor</th>
                  <th className="py-2 pr-4 font-medium">Type · Bureau</th>
                  <th className="py-2 pr-4 text-right font-medium">Balance</th>
                  <th className="py-2 pl-4 font-medium">Status</th>
                  <th className="py-2 pl-4 font-medium">
                    <span className="sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {rankedAccounts.map((account) => {
                  const urgent = severityRank[account.status] <= 1;
                  return (
                    <tr key={account.id} className="transition-colors duration-fast hover:bg-bg-muted">
                      <td
                        className={`py-3 pr-4 text-text-primary ${urgent ? 'text-base font-semibold' : 'font-medium'}`}
                      >
                        {account.creditorName}
                      </td>
                      <td className="py-3 pr-4 text-text-muted">
                        {account.accountType} · {account.bureau}
                      </td>
                      <td className="py-3 pr-4 text-right font-mono tabular-nums text-text-secondary">
                        {currencyFormatter.format(account.currentBalance)}
                      </td>
                      <td className="py-3 pl-4">
                        <AccountStatusBadge status={account.status} />
                      </td>
                      <td className="py-3 pl-4 text-right">
                        {urgent && (
                          <Link
                            href={`/disputes/new?account=${account.id}`}
                            className="inline-flex items-center gap-1.5 text-sm font-semibold text-teal-700 hover:text-teal-800"
                          >
                            <GavelIcon className="h-3.5 w-3.5" />
                            Dispute
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Mobile stacked cards */}
            <div className="flex flex-col divide-y divide-border-subtle sm:hidden">
              {rankedAccounts.map((account) => {
                const urgent = severityRank[account.status] <= 1;
                return (
                  <div key={account.id} className="flex flex-col gap-2 py-3">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className={`text-text-primary ${urgent ? 'text-base font-semibold' : 'text-sm font-medium'}`}>
                          {account.creditorName}
                        </div>
                        <div className="text-xs text-text-muted">
                          {account.accountType} · {account.bureau}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className="font-mono text-sm tabular-nums text-text-secondary">
                          {currencyFormatter.format(account.currentBalance)}
                        </span>
                        <AccountStatusBadge status={account.status} />
                      </div>
                    </div>
                    {urgent && (
                      <Link
                        href={`/disputes/new?account=${account.id}`}
                        className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-teal-700 hover:text-teal-800"
                      >
                        <GavelIcon className="h-3.5 w-3.5" />
                        Dispute this account
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
