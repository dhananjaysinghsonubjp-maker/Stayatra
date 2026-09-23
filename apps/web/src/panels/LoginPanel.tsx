import { useState } from 'react';
import { mutate, ApiError } from '../api';
import { useAuth } from '../AuthContext';
import { Button, Field, inputClass } from '../components/ui';

type Mode = 'login' | 'signup' | 'pin';

export function LoginPanel() {
  const { setToken } = useAuth();
  const [mode, setMode] = useState<Mode>('signup');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [organizationName, setOrganizationName] = useState('Test Hotels Pvt Ltd');
  const [ownerName, setOwnerName] = useState('Asha Verma');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [shortCode, setShortCode] = useState('');
  const [pin, setPin] = useState('');
  const [deviceId, setDeviceId] = useState('simulator-device-1');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'signup') {
        const result = await mutate<{ session: { token: string } }>('auth.signup', {
          organizationName,
          ownerName,
          email,
          password,
        });
        setToken(result.session.token);
      } else if (mode === 'login') {
        const result = await mutate<{ session: { token: string } }>('auth.login', { email, password });
        setToken(result.session.token);
      } else {
        const result = await mutate<{ session: { token: string } }>('auth.pinLogin', { shortCode, pin, deviceId });
        setToken(result.session.token);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  const tabs: { id: Mode; label: string }[] = [
    { id: 'signup', label: 'Owner Signup' },
    { id: 'login', label: 'Owner Login' },
    { id: 'pin', label: 'Staff PIN' },
  ];

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-base font-bold text-white">H</div>
          <span className="text-lg font-semibold text-slate-900">Hotel Platform</span>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex rounded-lg bg-slate-100 p-1">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setMode(t.id)}
                className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${
                  mode === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-3.5">
            {mode === 'signup' && (
              <>
                <Field label="Organization name">
                  <input className={inputClass} value={organizationName} onChange={(e) => setOrganizationName(e.target.value)} required />
                </Field>
                <Field label="Owner name">
                  <input className={inputClass} value={ownerName} onChange={(e) => setOwnerName(e.target.value)} required />
                </Field>
              </>
            )}
            {mode !== 'pin' && (
              <>
                <Field label="Email">
                  <input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </Field>
                <Field label="Password">
                  <input className={inputClass} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
                </Field>
              </>
            )}
            {mode === 'pin' && (
              <>
                <Field label="Hotel ID (short code)">
                  <input className={inputClass} value={shortCode} onChange={(e) => setShortCode(e.target.value.toUpperCase())} required />
                </Field>
                <Field label="PIN">
                  <input className={inputClass} value={pin} onChange={(e) => setPin(e.target.value)} required minLength={4} maxLength={6} />
                </Field>
                <Field label="Device ID">
                  <input className={inputClass} value={deviceId} onChange={(e) => setDeviceId(e.target.value)} required />
                </Field>
              </>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? 'Working…' : mode === 'signup' ? 'Create account' : mode === 'login' ? 'Log in' : 'Log in with PIN'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
