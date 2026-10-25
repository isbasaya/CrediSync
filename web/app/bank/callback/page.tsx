'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { Notice, PageShell } from '@/components/ui';
import { completeBankLink, describeError } from '@/lib/api-client';
import { RequireSession } from '@/lib/session';

/**
 * Stitch redirects here after the consumer approves (or cancels) access at
 * their bank. The code and state go straight to the API, which validates the
 * state and exchanges the code server-side; nothing is stored in the browser.
 */
function Callback() {
  const params = useSearchParams();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const code = params.get('code');
    const state = params.get('state');
    if (params.get('error') || !code || !state) {
      setError(
        params.get('error') === 'access_denied'
          ? 'You cancelled the bank connection. Nothing was shared.'
          : 'The bank connection didn’t complete. Please try again.',
      );
      return;
    }
    completeBankLink(code, state)
      .then(() => router.replace('/bank?linked=1'))
      .catch((err) => setError(describeError(err, 'We couldn’t connect your bank account.')));
  }, [params, router]);

  return (
    <PageShell title="Connecting your bank account">
      {error ? (
        <>
          <Notice tone="error">{error}</Notice>
          <Link href="/bank" className="text-sm font-semibold text-teal-700 hover:text-teal-800">
            Back to bank account
          </Link>
        </>
      ) : (
        <Notice>Finishing the connection…</Notice>
      )}
    </PageShell>
  );
}

export default function BankCallbackPage() {
  return (
    <>
      <AppHeader />
      <RequireSession>
        <Suspense>
          <Callback />
        </Suspense>
      </RequireSession>
    </>
  );
}
