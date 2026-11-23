'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Notice } from '../components/ui';
import { getMe, isSignedOutError, logout as apiLogout } from './api-client';
import type { Me } from './types';

interface SessionValue {
  me: Me | null;
  loading: boolean;
  /** The last session check failed for a reason other than being signed out. */
  unavailable: boolean;
  reload: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  const reload = useCallback(async () => {
    try {
      setMe(await getMe());
      setUnavailable(false);
    } catch (err) {
      if (isSignedOutError(err)) {
        setMe(null);
        setUnavailable(false);
      } else {
        setUnavailable(true);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    await apiLogout().catch(() => undefined);
    setMe(null);
    setUnavailable(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <SessionContext.Provider value={{ me, loading, unavailable, reload, signOut }}>
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
  const { me, loading, unavailable, reload } = useSession();
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (!loading && !me && !unavailable) router.replace('/login');
  }, [loading, me, unavailable, router]);

  if (!loading && !me && unavailable) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-md flex-col justify-center gap-4 px-4">
        <Notice tone="error">
          We couldn’t load your account right now. You’re still signed in, so please try again in a
          moment.
        </Notice>
        <Button
          busy={retrying}
          onClick={async () => {
            setRetrying(true);
            await reload();
            setRetrying(false);
          }}
        >
          Try again
        </Button>
      </div>
    );
  }

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
