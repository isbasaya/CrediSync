'use client';

import { useState } from 'react';
import { AppHeader } from '@/components/AppHeader';
import { Button, Checkbox, Notice, PageShell } from '@/components/ui';
import { cancelDeletion, describeError, exportMyData, requestDeletion, updateConsents } from '@/lib/api-client';
import { RequireSession, useSession } from '@/lib/session';

type ConsentKey = 'creditCheck' | 'openBanking' | 'marketing' | 'thirdPartySharing';

const CONSENTS: Array<{ key: ConsentKey; label: string; detail: string }> = [
  {
    key: 'creditCheck',
    label: 'Request my credit reports',
    detail: 'Lets CrediSync fetch your reports from TransUnion, Experian and XDS. Checking your own report doesn’t affect your score.',
  },
  {
    key: 'openBanking',
    label: 'Read my bank transactions',
    detail: 'Used only to estimate affordability and bank readiness. Turning this off disconnects linked bank accounts.',
  },
  { key: 'marketing', label: 'Tips and product news', detail: 'Occasional emails. Never shared with lenders.' },
  { key: 'thirdPartySharing', label: 'Share my profile with partner lenders', detail: 'Off unless you turn it on. You choose each time we ask.' },
];

function Privacy() {
  const { me, reload } = useSession();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  if (!me) return null;

  async function toggle(key: ConsentKey, value: boolean) {
    setBusyKey(key);
    setMessage(null);
    try {
      await updateConsents({ [key]: value });
      await reload();
      setMessage({ tone: 'success', text: 'Your permissions were updated.' });
    } catch (err) {
      setMessage({ tone: 'error', text: describeError(err, 'We couldn’t update your permissions.') });
    } finally {
      setBusyKey(null);
    }
  }

  async function download() {
    setBusyKey('export');
    setMessage(null);
    try {
      const data = await exportMyData();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'credisync-personal-data.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setMessage({ tone: 'error', text: describeError(err, 'We couldn’t prepare your data.') });
    } finally {
      setBusyKey(null);
    }
  }

  async function deletion(schedule: boolean) {
    if (schedule && !window.confirm('Delete your CrediSync account? You can cancel within 7 days; after that it can’t be undone.')) return;
    setBusyKey('delete');
    setMessage(null);
    try {
      if (schedule) await requestDeletion();
      else await cancelDeletion();
      await reload();
    } catch (err) {
      setMessage({ tone: 'error', text: describeError(err, 'We couldn’t process that request.') });
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <PageShell title="Privacy and permissions" intro="You control what CrediSync does with your information, under the Protection of Personal Information Act.">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <section className="flex flex-col gap-4 rounded-2xl border border-border-default bg-bg-surface p-6" aria-labelledby="permissions">
        <h2 id="permissions" className="text-sm font-semibold text-text-primary">
          Permissions
        </h2>
        {CONSENTS.map((c) => (
          <Checkbox
            key={c.key}
            id={`consent-${c.key}`}
            label={c.label}
            checked={me.consents[c.key]}
            disabled={busyKey === c.key}
            onChange={(e) => void toggle(c.key, e.target.checked)}
          >
            {c.detail}
          </Checkbox>
        ))}
        <p className="text-xs text-text-muted">Privacy notice accepted: version {me.consents.popiaPolicyVersion ?? '—'}.</p>
      </section>

      <section className="flex flex-col items-start gap-3 rounded-2xl border border-border-default bg-bg-surface p-6" aria-labelledby="your-data">
        <h2 id="your-data" className="text-sm font-semibold text-text-primary">
          Your data
        </h2>
        <p className="text-sm text-text-secondary">Download a copy of everything we hold about you, including your consent history.</p>
        <Button variant="secondary" busy={busyKey === 'export'} onClick={download}>
          Download my data
        </Button>
      </section>

      <section className="flex flex-col items-start gap-3 rounded-2xl border border-border-default bg-bg-surface p-6" aria-labelledby="delete">
        <h2 id="delete" className="text-sm font-semibold text-text-primary">
          Delete my account
        </h2>
        {me.deletionScheduledFor ? (
          <>
            <Notice>
              Your account will be deleted on {new Date(me.deletionScheduledFor).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })}.
            </Notice>
            <Button variant="secondary" busy={busyKey === 'delete'} onClick={() => deletion(false)}>
              Keep my account
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-text-secondary">
              We delete your profile, reports, bank data and uploaded documents after a 7-day grace period. A minimal, anonymised record of
              the request is kept for compliance.
            </p>
            <Button variant="danger" busy={busyKey === 'delete'} onClick={() => deletion(true)}>
              Delete my account
            </Button>
          </>
        )}
      </section>
    </PageShell>
  );
}

export default function PrivacyPage() {
  return (
    <>
      <AppHeader />
      <RequireSession>
        <Privacy />
      </RequireSession>
    </>
  );
}
