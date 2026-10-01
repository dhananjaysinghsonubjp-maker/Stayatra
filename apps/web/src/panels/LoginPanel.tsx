import { useEffect, useState } from 'react';
import { mutate, query, ApiError } from '../api';
import { useAuth } from '../AuthContext';
import { Button, Field, inputClass } from '../components/ui';

type Mode = 'login' | 'signup' | 'pin';

interface Plan {
  id: string;
  key: string;
  name: string;
  description: string;
  modules: string[];
  priceMonthly: string;
}

export function LoginPanel() {
  const { setToken } = useAuth();
  const [mode, setMode] = useState<Mode>('signup');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);

  const [organizationName, setOrganizationName] = useState('Test Hotels Pvt Ltd');
  const [ownerName, setOwnerName] = useState('Asha Verma');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [shortCode, setShortCode] = useState('');
  const [pin, setPin] = useState('');
  const [deviceId, setDeviceId] = useState('simulator-device-1');

  useEffect(() => {
    query<Plan[]>('plans.list', undefined).then(setPlans);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'signup') {
        if (!selectedPlan) throw new Error('Choose a plan first');
        const result = await mutate<{ session: { token: string } }>('auth.signup', {
          organizationName,
          ownerName,
          email,
          password,
          planKey: selectedPlan.key,
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
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  const tabs: { id: Mode; label: string }[] = [
    { id: 'signup', label: 'Owner Signup' },
    { id: 'login', label: 'Owner Login' },
    { id: 'pin', label: 'Staff PIN' },
  ];

  // Step 1 of signup: pick a plan — a wider pricing grid, not the narrow login card.
  if (mode === 'signup' && !selectedPlan) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-12">
        <div className="mx-auto max-w-5xl">
          <div className="mb-8 text-center">
            <div className="mb-3 flex items-center justify-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-base font-bold text-white">H</div>
              <span className="text-lg font-semibold text-slate-900">Hotel Platform</span>
            </div>
            <h1 className="text-2xl font-bold text-slate-900">Choose your plan</h1>
            <p className="mt-1 text-sm text-slate-500">
              Start free for 7 days. Already have an account?{' '}
              <button onClick={() => setMode('login')} className="font-medium text-brand-600 hover:underline">
                Log in
              </button>
            </p>
          </div>

          {plans.length === 0 ? (
            <p className="text-center text-sm text-slate-400">Loading plans…</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {plans.map((plan) => (
                <button
                  key={plan.id}
                  onClick={() => setSelectedPlan(plan)}
                  className="flex flex-col rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm transition-colors hover:border-brand-400 hover:shadow-md"
                >
                  <h3 className="text-sm font-semibold text-slate-900">{plan.name}</h3>
                  <p className="mt-1 text-2xl font-bold text-slate-900">
                    ₹{Number(plan.priceMonthly).toLocaleString('en-IN')}
                    <span className="text-sm font-normal text-slate-400">/mo</span>
                  </p>
                  <p className="mt-2 flex-1 text-xs text-slate-500">{plan.description}</p>
                  <span className="mt-4 rounded-lg bg-brand-50 px-3 py-2 text-center text-xs font-medium text-brand-700">Select this plan →</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

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

          {mode === 'signup' && selectedPlan && (
            <div className="mb-4 flex items-center justify-between rounded-lg bg-brand-50 px-3 py-2 text-xs">
              <span className="font-medium text-brand-800">
                {selectedPlan.name} · ₹{Number(selectedPlan.priceMonthly).toLocaleString('en-IN')}/mo
              </span>
              <button type="button" onClick={() => setSelectedPlan(null)} className="text-brand-600 hover:underline">
                Change plan
              </button>
            </div>
          )}

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
