'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, getMe, logout as apiLogout } from './api-client';
import type { Me } from './types';

interface SessionValue {
  me: Me | null;
  loading: boolean;
  reload: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      setMe(await getMe());
    } catch (err) {
      if (!(err instanceof ApiError) || err.status === 401) setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    await apiLogout().catch(() => undefined);
    setMe(null);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <SessionContext.Provider value={{ me, loading, reload, signOut }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}

/** Renders children for a signed-in user; otherwise sends them to sign in. */
export function RequireSession({ children }: { children: ReactNode }) {
  const { me, loading } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !me) router.replace('/login');
  }, [loading, me, router]);

  if (loading || !me) {
    return (
      <div
        className="flex min-h-[60vh] items-center justify-center"
        role="status"
        aria-live="polite"
      >
        <span className="sr-only">Loading your account</span>
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-border-default border-t-teal-700" />
      </div>
    );
  }
  return <>{children}</>;
}
