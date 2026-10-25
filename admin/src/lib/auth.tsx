'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from './api-client';

interface AuthUser {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: 'consumer' | 'admin' | 'compliance_officer';
}

interface AuthContextType {
  user: AuthUser | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  loading: boolean;
}

const STAFF_ROLES = new Set(['admin', 'compliance_officer']);
const AuthContext = createContext<AuthContextType | null>(null);

export class NotStaffError extends Error {
  constructor() {
    super('This account does not have access to the operations portal.');
    this.name = 'NotStaffError';
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const loadMe = useCallback(async (): Promise<AuthUser | null> => {
    try {
      const me = await api.get<AuthUser>('/me');
      return STAFF_ROLES.has(me.role) ? me : null;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return null;
      throw err;
    }
  }, []);

  useEffect(() => {
    loadMe()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, [loadMe]);

  const login = useCallback(
    async (email: string, password: string) => {
      await api.post('/auth/login', { email, password });
      const me = await loadMe();
      if (!me) {
        // Signed in, but not staff: end the session rather than leave a consumer session in the admin portal.
        await api.post('/auth/logout').catch(() => undefined);
        throw new NotStaffError();
      }
      setUser(me);
    },
    [loadMe],
  );

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => undefined);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, logout, loading }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
