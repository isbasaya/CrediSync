'use client';

import { Suspense, useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { AccountStatusBadge } from '@/components/AccountStatusBadge';
import { Button, Notice, PageShell } from '@/components/ui';
import { createDispute, describeError, getBureauAccounts, submitDispute } from '@/lib/api-client';
import { RequireSession } from '@/lib/session';
import { BUREAU_LABELS, DISPUTE_REASON_LABELS, type BureauAccountSummary, type Dispute, type DisputeReason } from '@/lib/types';

const currency = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' });
const MIN_DESCRIPTION = 20;

function NewDispute() {
  const params = useSearchParams();
  const router = useRouter();
  const clusterId = params.get('account');

  const [account, setAccount] = useState<BureauAccountSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [recordId, setRecordId] = useState<string>('');
  const [reason, setReason] = useState<DisputeReason | ''>('');
  const [description, setDescription] = useState('');
  const [draft, setDraft] = useState<Dispute | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getBureauAccounts()
      .then((accounts) => {
        const match = accounts.find((a) => a.resolvedAccountId === clusterId) ?? null;
        if (!match) setLoadError('We couldn’t find that account on your profile.');
        setAccount(match);
        if (match?.reportedBy.length === 1) setRecordId(match.reportedBy[0]!.accountId);
      })
      .catch((err) => setLoadError(describeError(err, 'We couldn’t load your accounts.')));
  }, [clusterId]);

  const record = useMemo(() => account?.reportedBy.find((r) => r.accountId === recordId) ?? null, [account, recordId]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!recordId || !reason || description.trim().length < MIN_DESCRIPTION) return;
    setBusy(true);
    setError(null);
    try {
      setDraft(await createDispute({ bureauAccountId: recordId, reason, description }));
    } catch (err) {
      setError(describeError(err, 'We couldn’t prepare your dispute.'));
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      await submitDispute(draft.id);
      router.replace(`/disputes?sent=${draft.id}`);
    } catch (err) {
      setError(describeError(err, 'We couldn’t send your dispute.'));
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <PageShell title="Dispute an account">
        <Notice tone="error">{loadError}</Notice>
        <Link href="/" className="text-sm font-semibold text-teal-700">
          Back to your credit profile
        </Link>
      </PageShell>
    );
  }
  if (!account) {
    return (
      <PageShell title="Dispute an account">
        <div className="h-40 animate-pulse rounded-2xl bg-bg-muted" role="status" aria-label="Loading account" />
      </PageShell>
    );
  }

  if (draft) {
    return (
      <PageShell
        title="Check your dispute letter"
        intro={`This is what we’ll send to ${BUREAU_LABELS[draft.bureau]}. The bureau must respond within 20 business days of receiving it.`}
      >
        {error && <Notice tone="error">{error}</Notice>}
        <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-xl border border-border-default bg-bg-surface p-4 font-sans text-sm leading-relaxed text-text-secondary">
          {draft.letterContent}
        </pre>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button onClick={onSubmit} busy={busy}>
            Send to {BUREAU_LABELS[draft.bureau]}
          </Button>
          <Link href="/disputes" className="inline-flex h-11 items-center justify-center rounded-lg px-4 text-sm font-semibold text-text-muted hover:text-text-primary">
            Save as draft
          </Link>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell title={`Dispute ${account.creditorName}`} intro="Disputing is free. The bureau investigates with the lender and must correct anything it can’t verify.">
      <form onSubmit={onCreate} className="flex flex-col gap-6" noValidate>
        {error && <Notice tone="error">{error}</Notice>}

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-sm font-semibold text-text-primary">Which bureau’s record is wrong?</legend>
          {account.reportedBy.map((r) => (
            <label
              key={r.accountId}
              className={`flex cursor-pointer items-center justify-between gap-4 rounded-xl border p-4 transition-colors duration-fast ${
                recordId === r.accountId ? 'border-teal-700 bg-teal-050' : 'border-border-default bg-bg-surface hover:border-teal-700/50'
              }`}
            >
              <span className="flex items-center gap-3">
                <input type="radio" name="record" value={r.accountId} checked={recordId === r.accountId} onChange={() => setRecordId(r.accountId)} className="h-4 w-4 accent-teal-700" />
                <span className="text-sm font-medium text-text-primary">{BUREAU_LABELS[r.bureau]}</span>
              </span>
              <span className="flex items-center gap-3">
                <span className="font-mono text-sm tabular-nums text-text-secondary">{currency.format(r.currentBalance)}</span>
                <AccountStatusBadge status={r.status} />
              </span>
            </label>
          ))}
          {account.reportedBy.length > 1 && (
            <p className="text-xs text-text-muted">If more than one bureau is wrong, file a separate dispute for each.</p>
          )}
        </fieldset>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="reason" className="text-sm font-semibold text-text-primary">
            What’s wrong with it?
          </label>
          <select
            id="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value as DisputeReason)}
            className="h-11 rounded-lg border border-border-default bg-bg-surface px-3 text-base text-text-primary focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
          >
            <option value="">Choose a reason</option>
            {(Object.keys(DISPUTE_REASON_LABELS) as DisputeReason[]).map((r) => (
              <option key={r} value={r}>
                {DISPUTE_REASON_LABELS[r]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="description" className="text-sm font-semibold text-text-primary">
            Explain in your own words
          </label>
          <textarea
            id="description"
            rows={5}
            maxLength={4000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            aria-describedby="description-hint"
            className="rounded-lg border border-border-default bg-bg-surface p-3 text-base text-text-primary focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
          />
          <p id="description-hint" className="text-xs text-text-muted">
            Include dates and amounts if you have them, e.g. “I paid the balance of R6,420 on 14 March 2024.” At least {MIN_DESCRIPTION} characters.
          </p>
        </div>

        <Button type="submit" busy={busy} disabled={!record || !reason || description.trim().length < MIN_DESCRIPTION}>
          Preview letter
        </Button>
      </form>
    </PageShell>
  );
}

export default function NewDisputePage() {
  return (
    <>
      <AppHeader />
      <RequireSession>
        <Suspense>
          <NewDispute />
        </Suspense>
      </RequireSession>
    </>
  );
}
