'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { Notice, PageShell } from '@/components/ui';
import { describeError, listDisputes } from '@/lib/api-client';
import { RequireSession } from '@/lib/session';
import { BUREAU_LABELS, DISPUTE_REASON_LABELS, DISPUTE_STATUS_LABELS, type Dispute } from '@/lib/types';

const date = (iso: string) => new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });

function statusTone(d: Dispute): string {
  if (d.status === 'resolved_upheld') return 'bg-status-current-bg text-status-current-fg';
  if (d.status === 'resolved_rejected' || d.deadlineBreachedAt) return 'bg-status-arrears-bg text-status-arrears-fg';
  return 'bg-teal-050 text-teal-800';
}

function DisputeList() {
  const params = useSearchParams();
  const [disputes, setDisputes] = useState<Dispute[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listDisputes()
      .then((r) => setDisputes(r.disputes))
      .catch((err) => setError(describeError(err, 'We couldn’t load your disputes.')));
  }, []);

  return (
    <PageShell title="Your disputes" intro="Bureaus must respond within 20 business days. We’ll email you when anything changes.">
      {params.get('sent') && <Notice tone="success">Your dispute has been sent. We’ll let you know when the bureau responds.</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {disputes === null && !error && <div className="h-32 animate-pulse rounded-2xl bg-bg-muted" role="status" aria-label="Loading disputes" />}
      {disputes?.length === 0 && (
        <p className="text-sm text-text-secondary">
          You haven’t disputed anything yet. If an account on your{' '}
          <Link href="/" className="font-semibold text-teal-700">
            credit profile
          </Link>{' '}
          looks wrong, use its Dispute link.
        </p>
      )}
      {disputes && disputes.length > 0 && (
        <ul className="flex flex-col divide-y divide-border-subtle rounded-2xl border border-border-default bg-bg-surface">
          {disputes.map((d) => (
            <li key={d.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-text-primary">
                  {d.creditorName ?? 'Account'} · {BUREAU_LABELS[d.bureau]}
                </div>
                <div className="text-xs text-text-muted">
                  {DISPUTE_REASON_LABELS[d.disputeReason]} · opened {date(d.createdAt)}
                </div>
                {d.deadlineBreachedAt && (
                  <div className="mt-1 text-xs font-medium text-status-arrears-fg">The bureau missed its deadline — you can now escalate this.</div>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusTone(d)}`}>{DISPUTE_STATUS_LABELS[d.status]}</span>
                {d.resolutionDeadline && !d.status.startsWith('resolved') && (
                  <span className="text-xs text-text-muted">Response due {date(d.resolutionDeadline)}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}

export default function DisputesPage() {
  return (
    <>
      <AppHeader />
      <RequireSession>
        <Suspense>
          <DisputeList />
        </Suspense>
      </RequireSession>
    </>
  );
}
