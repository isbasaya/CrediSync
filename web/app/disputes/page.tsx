'use client';

import { Suspense, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { Button, Field, Notice, PageShell } from '@/components/ui';
import { describeError, disputeLetterUrl, escalateDispute, listDisputes } from '@/lib/api-client';
import { canEscalate, showsResponseDue } from '@/lib/disputes';
import { RequireSession } from '@/lib/session';
import {
  BUREAU_LABELS,
  DISPUTE_REASON_LABELS,
  DISPUTE_STATUS_LABELS,
  type Dispute,
} from '@/lib/types';

const date = (iso: string) =>
  new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });

function statusTone(d: Dispute): string {
  if (d.status === 'resolved_upheld') return 'bg-status-current-bg text-status-current-fg';
  if (canEscalate(d)) return 'bg-status-arrears-bg text-status-arrears-fg';
  return 'bg-teal-050 text-teal-800';
}

/** Escalation needs the case number the Credit Ombud issues, so it starts with them. */
function EscalateForm({ dispute, onEscalated }: { dispute: Dispute; onEscalated: () => void }) {
  const [open, setOpen] = useState(false);
  const [caseNumber, setCaseNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reason =
    dispute.status === 'resolved_rejected'
      ? 'The bureau didn’t correct this record.'
      : 'The bureau missed its deadline.';

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await escalateDispute(dispute.id, caseNumber.trim());
      onEscalated();
    } catch (err) {
      setError(describeError(err, 'We couldn’t record your escalation.'));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="mt-1 text-xs font-medium text-status-arrears-fg">
        {reason}{' '}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="cursor-pointer font-semibold text-teal-700 underline hover:text-teal-800"
        >
          Escalate this dispute
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-3 flex flex-col gap-3">
      {error && <Notice tone="error">{error}</Notice>}
      <Field
        id={`case-${dispute.id}`}
        label="Credit Ombud case number"
        hint="Lodge a complaint with the Credit Ombud first, then enter the case number they give you."
        value={caseNumber}
        maxLength={64}
        onChange={(e) => setCaseNumber(e.target.value)}
      />
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button type="submit" busy={busy} disabled={!caseNumber.trim()}>
          Record escalation
        </Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function DisputeList() {
  const params = useSearchParams();
  const [disputes, setDisputes] = useState<Dispute[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    listDisputes()
      .then((r) => setDisputes(r.disputes))
      .catch((err) => setError(describeError(err, 'We couldn’t load your disputes.')));

  useEffect(() => {
    void load();
  }, []);

  return (
    <PageShell
      title="Your disputes"
      intro="Bureaus must respond within 20 business days. We’ll email you when anything changes."
    >
      {params.get('sent') && (
        <Notice tone="success">
          Your dispute has been sent. We’ll let you know when the bureau responds.
        </Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      {disputes === null && !error && (
        <div
          className="h-32 animate-pulse rounded-2xl bg-bg-muted"
          role="status"
          aria-label="Loading disputes"
        />
      )}
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
            <li
              key={d.id}
              className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-text-primary">
                  {d.creditorName ?? 'Account'} · {BUREAU_LABELS[d.bureau]}
                </div>
                <div className="text-xs text-text-muted">
                  {DISPUTE_REASON_LABELS[d.disputeReason]} · opened {date(d.createdAt)}
                </div>
                {d.status === 'draft' && (
                  <Link
                    href={`/disputes/new?draft=${d.id}`}
                    className="mt-1 inline-block text-xs font-semibold text-teal-700 underline hover:text-teal-800"
                  >
                    Continue draft
                  </Link>
                )}
                {canEscalate(d) && <EscalateForm dispute={d} onEscalated={() => void load()} />}
              </div>
              <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusTone(d)}`}>
                  {DISPUTE_STATUS_LABELS[d.status]}
                </span>
                {d.letterContent !== null && (
                  <a
                    href={disputeLetterUrl(d.id)}
                    className="text-xs font-semibold text-teal-700 hover:text-teal-800"
                  >
                    Download letter (PDF)
                  </a>
                )}
                {showsResponseDue(d) && (
                  <span className="text-xs text-text-muted">
                    Response due {date(d.resolutionDeadline!)}
                  </span>
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
