'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { NotStaffError, useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api-client';
import { AlertTriangleIcon, LockIcon, LogoMark, MailIcon } from '@/components/icons';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(email, password);
      router.push('/');
    } catch (err) {
      if (err instanceof NotStaffError) {
        setError(err.message);
      } else if (err instanceof ApiError) {
        setError(
          err.status === 401
            ? 'Invalid email or password, or the account is temporarily locked.'
            : err.status === 429
              ? 'Too many attempts. Wait a minute and try again.'
              : 'We couldn’t sign you in. Try again shortly.',
        );
      } else {
        setError('We can’t reach CrediSync. Check your connection.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg-base p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-teal-050 text-teal-700">
            <LogoMark className="h-6 w-6" />
          </span>
          <h1 className="text-2xl font-bold text-text-primary">CrediSync Admin</h1>
          <p className="mt-2 text-sm text-text-muted">Sign in to the operations portal</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-2xl border border-border-default bg-bg-surface p-6 shadow-md"
        >
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-status-very-poor-fg/25 bg-status-very-poor-bg px-3 py-2 text-sm text-status-very-poor-fg">
              <AlertTriangleIcon className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          <div>
            <label htmlFor="email" className="mb-1 block text-sm text-text-secondary">
              Email
            </label>
            <div className="relative">
              <MailIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="w-full rounded-lg border border-border-default bg-bg-surface py-2 pl-9 pr-3 text-text-primary placeholder-text-muted transition-colors duration-fast focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
                placeholder="admin@credisync.co.za"
              />
            </div>
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-sm text-text-secondary">
              Password
            </label>
            <div className="relative">
              <LockIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full rounded-lg border border-border-default bg-bg-surface py-2 pl-9 pr-3 text-text-primary placeholder-text-muted transition-colors duration-fast focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
                placeholder="••••••••"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full cursor-pointer rounded-lg bg-brand-primary py-2 font-semibold text-white transition-colors duration-fast hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
