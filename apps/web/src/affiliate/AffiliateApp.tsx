import { useEffect, useState } from 'react';
import { query } from '../api';
import { AffiliateLogin } from './AffiliateLogin';
import { AffiliateDashboard } from './AffiliateDashboard';

export interface ActingAffiliate {
  affiliateId: string;
  name: string;
  email: string;
  brandName: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
}

/**
 * The reseller/white-label partner's own console — a scoped, re-skinned copy
 * of Platform Admin (see affiliate.service.ts). Own token, own login, no
 * shared state with either AuthContext or AdminApp. Mounted at /partner.
 */
const AFFILIATE_TOKEN_KEY = 'affiliate_token';

export function AffiliateApp() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(AFFILIATE_TOKEN_KEY));
  const [affiliate, setAffiliate] = useState<ActingAffiliate | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    query<ActingAffiliate>('affiliate.me', undefined, token)
      .then(setAffiliate)
      .catch(() => {
        localStorage.removeItem(AFFILIATE_TOKEN_KEY);
        setToken(null);
      })
      .finally(() => setLoading(false));
  }, [token]);

  function onLogin(next: ActingAffiliate & { token: string }) {
    localStorage.setItem(AFFILIATE_TOKEN_KEY, next.token);
    setToken(next.token);
    setAffiliate(next);
  }

  function logout() {
    localStorage.removeItem(AFFILIATE_TOKEN_KEY);
    setToken(null);
    setAffiliate(null);
  }

  if (loading) {
    return <div className="flex h-screen items-center justify-center text-sm text-slate-400">Loading…</div>;
  }
  if (!token || !affiliate) return <AffiliateLogin onLogin={onLogin} />;
  return <AffiliateDashboard affiliate={affiliate} token={token} onLogout={logout} />;
}
