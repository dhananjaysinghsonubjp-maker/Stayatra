import { useState } from 'react';
import { mutate, ApiError } from '../api';
import { Button } from '../components/ui';
import type { PlatformAdmin } from './AdminApp';

// Dark-background variant of components/ui.tsx's shared Field/inputClass — those are tuned for
// the light theme used everywhere else in the app, so this page (deliberately dark, §ask) styles
// its own label/input directly rather than overriding shared styles that other pages depend on.
function DarkField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-slate-300">{label}</span>
      {children}
    </label>
  );
}
const darkInputClass =
  'rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30';

export function AdminLogin({ onLogin }: { onLogin: (result: PlatformAdmin & { token: string }) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await mutate<PlatformAdmin & { token: string }>('platformAdmin.login', { email, password });
      onLogin(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      {/* A faint grid + glow — distinguishes this from the hotel-owner login as the serious,
          internal ops console, without pulling in any new asset or library. */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage: 'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
          backgroundSize: '44px 44px',
        }}
      />
      <div className="pointer-events-none absolute left-1/2 top-0 h-[480px] w-[480px] -translate-x-1/2 rounded-full bg-brand-600/20 blur-[120px]" />

      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-xl font-bold text-white shadow-lg shadow-brand-900/40">
            H
          </div>
          <h1 className="text-xl font-semibold text-white">StayYatra</h1>
          <p className="mt-1 text-sm text-slate-400">Platform Admin Console</p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 shadow-2xl backdrop-blur-sm">
          <p className="mb-5 text-xs text-slate-400">
            Operator access only — manages every tenant organization. Not a hotel account.
          </p>
          <form onSubmit={submit} className="space-y-4">
            <DarkField label="Email">
              <input className={darkInputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            </DarkField>
            <DarkField label="Password">
              <input className={darkInputClass} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </DarkField>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-slate-500">© {new Date().getFullYear()} StayYatra. Internal use only.</p>
      </div>
    </div>
  );
}
