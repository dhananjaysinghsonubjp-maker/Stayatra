import { useEffect, useState } from 'react';
import { query } from '../api';
import { AdminLogin } from './AdminLogin';
import { AdminDashboard } from './AdminDashboard';

export interface PlatformAdmin {
  platformAdminId: string;
  name: string;
  email: string;
}

/**
 * A completely separate app root from the tenant-facing <App/> — its own
 * token (localStorage key below, never the tenant `token` key), its own
 * login, no shared state with AuthContext. A platform admin isn't a hotel
 * user with an extra role; it's a different kind of actor entirely (see
 * schema.prisma's PlatformAdmin model comment). Mounted at /admin — see main.tsx.
 */
const ADMIN_TOKEN_KEY = 'admin_token';

export function AdminApp() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(ADMIN_TOKEN_KEY));
  const [admin, setAdmin] = useState<PlatformAdmin | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    query<PlatformAdmin>('platformAdmin.me', undefined, token)
      .then(setAdmin)
      .catch(() => {
        localStorage.removeItem(ADMIN_TOKEN_KEY);
        setToken(null);
      })
      .finally(() => setLoading(false));
  }, [token]);

  function onLogin(next: PlatformAdmin & { token: string }) {
    localStorage.setItem(ADMIN_TOKEN_KEY, next.token);
    setToken(next.token);
    setAdmin(next);
  }

  function logout() {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    setToken(null);
    setAdmin(null);
  }

  if (loading) {
    return <div className="flex h-screen items-center justify-center text-sm text-slate-400">Loading…</div>;
  }
  if (!token || !admin) return <AdminLogin onLogin={onLogin} />;
  return <AdminDashboard admin={admin} token={token} onLogout={logout} />;
}
