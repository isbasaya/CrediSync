'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { Button, Field, Notice, PageShell } from '@/components/ui';
import { describeError, login } from '@/lib/api-client';
import { useSession } from '@/lib/session';

export default function LoginPage() {
  const router = useRouter();
  const { reload } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      await reload();
      router.replace('/');
    } catch (err) {
      setError(describeError(err, 'We couldn’t sign you in.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <AppHeader />
      <PageShell
        title="Sign in"
        intro="See your credit reports from all three South African bureaus in one place."
      >
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          {error && <Notice tone="error">{error}</Notice>}
          <Field
            id="email"
            label="Email address"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Field
            id="password"
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button type="submit" busy={busy}>
            Sign in
          </Button>
        </form>
        <p className="text-sm text-text-secondary">
          New to CrediSync?{' '}
          <Link href="/signup" className="font-semibold text-teal-700 hover:text-teal-800">
            Create an account
          </Link>
        </p>
      </PageShell>
    </>
  );
}
