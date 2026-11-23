'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  deleteDispute,
  describeError,
  getDispute,
  regenerateLetter,
  submitDispute,
} from '../lib/api-client';
import { MIN_DESCRIPTION } from '../lib/disputes';
import { BUREAU_LABELS, type Dispute } from '../lib/types';
import { Button, Notice, PageShell } from './ui';

/** Review a saved draft's letter, then send, edit or delete it. */
export function DraftReview({ id }: { id: string }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Dispute | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [description, setDescription] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState<'send' | 'save' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getDispute(id)
      .then((d) => {
        if (d.status !== 'draft') setLoadError('This dispute has already been sent.');
        setDraft(d);
        setDescription(d.disputeDescription);
      })
      .catch((err) => setLoadError(describeError(err, 'We couldn’t load your draft.')));
  }, [id]);

  async function run(action: 'send' | 'save' | 'delete', work: () => Promise<void>, fail: string) {
    setBusy(action);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(describeError(err, fail));
    } finally {
      setBusy(null);
    }
  }

  if (loadError) {
    return (
      <PageShell title="Your dispute">
        <Notice tone="error">{loadError}</Notice>
        <Link href="/disputes" className="text-sm font-semibold text-teal-700">
          Back to your disputes
        </Link>
      </PageShell>
    );
  }
  if (!draft) {
    return (
      <PageShell title="Check your dispute letter">
        <div
          className="h-40 animate-pulse rounded-2xl bg-bg-muted"
          role="status"
          aria-label="Loading draft"
        />
      </PageShell>
    );
  }

  const bureau = BUREAU_LABELS[draft.bureau];

  if (editing) {
    return (
      <PageShell title="Edit your explanation" intro="We’ll update the letter with your changes.">
        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="draft-description" className="text-sm font-semibold text-text-primary">
            Explain in your own words
          </label>
          <textarea
            id="draft-description"
            rows={6}
            maxLength={4000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            aria-describedby="draft-description-hint"
            className="rounded-lg border border-border-default bg-bg-surface p-3 text-base text-text-primary focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
          />
          <p id="draft-description-hint" className="text-xs text-text-muted">
            At least {MIN_DESCRIPTION} characters.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button
            busy={busy === 'save'}
            disabled={description.trim().length < MIN_DESCRIPTION}
            onClick={() =>
              run(
                'save',
                async () => {
                  setDraft(await regenerateLetter(draft.id, description));
                  setEditing(false);
                },
                'We couldn’t update your letter.',
              )
            }
          >
            Update letter
          </Button>
          <Button
            variant="secondary"
            disabled={busy !== null}
            onClick={() => {
              setDescription(draft.disputeDescription);
              setError(null);
              setEditing(false);
            }}
          >
            Cancel
          </Button>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Check your dispute letter"
      intro={`This is what we’ll send to ${bureau}. The bureau must respond within 20 business days of receiving it.`}
    >
      {error && <Notice tone="error">{error}</Notice>}
      <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-xl border border-border-default bg-bg-surface p-4 font-sans text-sm leading-relaxed text-text-secondary">
        {draft.letterContent}
      </pre>

      {confirmingDelete ? (
        <div className="flex flex-col gap-3 rounded-xl border border-border-default bg-bg-surface p-4">
          <p className="text-sm font-medium text-text-primary">
            Delete this draft? It hasn’t been sent, and you can’t get it back.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              variant="danger"
              busy={busy === 'delete'}
              onClick={() =>
                run(
                  'delete',
                  async () => {
                    await deleteDispute(draft.id);
                    router.replace('/disputes');
                  },
                  'We couldn’t delete your draft.',
                )
              }
            >
              Delete draft
            </Button>
            <Button
              variant="secondary"
              disabled={busy !== null}
              onClick={() => setConfirmingDelete(false)}
            >
              Keep draft
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <Button
            busy={busy === 'send'}
            onClick={() =>
              run(
                'send',
                async () => {
                  await submitDispute(draft.id);
                  router.replace(`/disputes?sent=${draft.id}`);
                },
                'We couldn’t send your dispute.',
              )
            }
          >
            Send to {bureau}
          </Button>
          <Button variant="secondary" disabled={busy !== null} onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Link
            href="/disputes"
            className="inline-flex h-11 items-center justify-center rounded-lg px-4 text-sm font-semibold text-text-muted hover:text-text-primary"
          >
            Save as draft
          </Link>
          <Button
            variant="danger"
            className="sm:ml-auto"
            disabled={busy !== null}
            onClick={() => setConfirmingDelete(true)}
          >
            Delete
          </Button>
        </div>
      )}
    </PageShell>
  );
}
