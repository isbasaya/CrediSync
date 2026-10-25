'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { Notice, PageShell } from '@/components/ui';
import { describeError, verifyEmail } from '@/lib/api-client';
import { useSession } from '@/lib/session';

function VerifyEmail() {
  const params = useSearchParams();
  const { reload } = useSession();
  const [state, setState] = useState<{ tone: 'info' | 'success' | 'error'; message: string }>({
    tone: 'info',
    message: 'Confirming your email address…',
  });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = params.get('token');
    if (!token) {
      setState({
        tone: 'error',
        message: 'This link is incomplete. Open the link from your email again.',
      });
      return;
    }
    verifyEmail(token)
      .then(async () => {
        await reload();
        setState({
          tone: 'success',
          message: 'Your email address is confirmed. You can now fetch your credit reports.',
        });
      })
      .catch((err) =>
        setState({
          tone: 'error',
          message: describeError(err, 'This link has expired or was already used.'),
        }),
      );
  }, [params, reload]);

  return (
    <PageShell title="Confirm your email">
      <Notice tone={state.tone}>{state.message}</Notice>
      {state.tone === 'success' && (
        <Link href="/" className="text-sm font-semibold text-teal-700 hover:text-teal-800">
          Go to your credit profile
        </Link>
      )}
    </PageShell>
  );
}

export default function VerifyEmailPage() {
  return (
    <>
      <AppHeader />
      <Suspense>
        <VerifyEmail />
      </Suspense>
    </>
  );
}
