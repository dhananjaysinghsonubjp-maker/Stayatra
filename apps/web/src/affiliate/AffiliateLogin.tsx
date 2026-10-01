import { useState } from 'react';
import { mutate, ApiError } from '../api';
import { Button, Card, Field, inputClass } from '../components/ui';
import type { ActingAffiliate } from './AffiliateApp';

// No branding here on purpose — without subdomain routing (deferred, needs
// real DNS/hosting) there's no way to know which partner is logging in until
// after they authenticate, so this page stays neutral. Branding applies once
// inside AffiliateDashboard.
export function AffiliateLogin({ onLogin }: { onLogin: (result: ActingAffiliate & { token: string }) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await mutate<ActingAffiliate & { token: string }>('affiliate.login', { email, password });
      onLogin(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-slate-900">
      <Card className="w-full max-w-sm p-6">
        <h1 className="mb-1 text-lg font-semibold text-slate-900">Partner Portal</h1>
        <p className="mb-5 text-xs text-slate-500">Manage the hotels you've referred.</p>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Email">
            <input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </Field>
          <Field label="Password">
            <input className={inputClass} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
