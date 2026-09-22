import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { query } from './api';
import type { ActingUser } from './types';

interface AuthState {
  token: string | null;
  user: ActingUser | null;
  loading: boolean;
  setToken: (token: string | null) => void;
  logout: () => void;
  role: (module: string) => string | undefined;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(() => localStorage.getItem('token'));
  const [user, setUser] = useState<ActingUser | null>(null);
  const [loading, setLoading] = useState(false);

  const setToken = useCallback((next: string | null) => {
    setTokenState(next);
    if (next) localStorage.setItem('token', next);
    else localStorage.removeItem('token');
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, [setToken]);

  useEffect(() => {
    if (!token) {
      setUser(null);
      return;
    }
    setLoading(true);
    query<ActingUser>('auth.me', undefined, token)
      .then(setUser)
      .catch(() => {
        setToken(null);
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, [token, setToken]);

  const role = useCallback((module: string) => user?.roles[module], [user]);

  return (
    <AuthContext.Provider value={{ token, user, loading, setToken, logout, role }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
