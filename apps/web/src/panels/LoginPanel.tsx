import { useEffect, useState } from 'react';
import { mutate, query, ApiError } from '../api';
import { useAuth } from '../AuthContext';
import { Button, Field, inputClass } from '../components/ui';

type Mode = 'pin' | 'signup' | 'login';

// A stable per-browser id for the PIN lockout mechanism (§8.1) — not something the
// person logging in should ever have to see or type, so it's generated once and kept
// in localStorage rather than being one of the 2 fields on the PIN login form.
function getDeviceId() {
  const key = 'device_id';
  let id = localStorage.getItem(key);
  if (!id) {
    id = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    localStorage.setItem(key, id);
  }
  return id;
}

interface Plan {
  id: string;
  key: string;
  name: string;
  description: string;
  modules: string[];
  priceMonthly: string;
}

// Marketing-only copy, keyed by plan — not server data, so changing these never needs a migration.
// Each list builds on the one before it, so the top plan visibly has the most checkmarks (the
// cheaper plans read as a subset of it, not a different product) — the recommended plan (§ask)
// also gets a distinct "pays for itself" framing, the one feature no cheaper plan can claim.
const PLAN_FEATURES: Record<string, string[]> = {
  channel_manager: ['Rates & availability synced across every OTA', 'All reservations in one calendar', 'Business reports & unified ledger'],
  pms: ['Front-desk check-in & Room View', 'Housekeeping workflow', 'Guest dues & daily reports'],
  cm_pms: ['Everything in Channel Manager', 'Everything in PMS', 'One login, one system — no switching tools'],
  cm_pms_theft: [
    'Everything in Channel Manager + PMS',
    'Automatic revenue-leakage detection',
    'Catches rooms given away off the books',
    'Typically recovers more than the plan costs',
  ],
};

export function LoginPanel() {
  const { setToken } = useAuth();
  const [mode, setMode] = useState<Mode>('pin');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [changingPlan, setChangingPlan] = useState(false);

  const [organizationName, setOrganizationName] = useState('Test Hotels Pvt Ltd');
  const [ownerName, setOwnerName] = useState('Asha Verma');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [shortCode, setShortCode] = useState('');
  const [pin, setPin] = useState('');

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
        const result = await mutate<{ session: { token: string } }>('auth.pinLogin', {
          shortCode,
          pin,
          deviceId: getDeviceId(),
        });
        setToken(result.session.token);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  const tabs: { id: Mode; label: string }[] = [
    { id: 'pin', label: 'PIN Login' },
    { id: 'signup', label: 'Admin Signup' },
    { id: 'login', label: 'Email & Password' },
  ];

  // Step 1 of signup: pick a plan — a wider pricing grid, not the narrow login card.
  if (mode === 'signup' && !selectedPlan) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-12">
        <div className="mx-auto max-w-5xl">
          <div className="mb-8 text-center">
            <div className="mb-3 flex items-center justify-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-base font-bold text-white">H</div>
              <span className="text-lg font-semibold text-slate-900">StayYatra</span>
            </div>
            <h1 className="text-2xl font-bold text-slate-900">Choose your plan</h1>
            <p className="mt-1 text-sm text-slate-500">
              Start free for 7 days. Already have an account?{' '}
              <button onClick={() => setMode('pin')} className="font-medium text-brand-600 hover:underline">
                Log in
              </button>
            </p>
          </div>

          {plans.length === 0 ? (
            <p className="text-center text-sm text-slate-400">Loading plans…</p>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {plans
                  .filter((p) => p.key !== 'cm_pms_theft')
                  .map((plan) => (
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
                      <ul className="mt-3 flex-1 space-y-1.5">
                        {(PLAN_FEATURES[plan.key] ?? []).map((f) => (
                          <li key={f} className="flex items-start gap-1.5 text-xs text-slate-500">
                            <span className="mt-0.5 text-slate-300">✓</span>
                            <span>{f}</span>
                          </li>
                        ))}
                      </ul>
                      <span className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-center text-xs font-medium text-slate-600">Select this plan →</span>
                    </button>
                  ))}
              </div>

              {plans
                .filter((p) => p.key === 'cm_pms_theft')
                .map((plan) => (
                  <button
                    key={plan.id}
                    onClick={() => setSelectedPlan(plan)}
                    className="relative mt-5 flex w-full flex-col gap-5 rounded-2xl border-2 border-brand-500 bg-gradient-to-br from-brand-50 to-white p-6 text-left shadow-lg shadow-brand-900/5 transition-transform hover:-translate-y-0.5 sm:flex-row sm:items-center"
                  >
                    <span className="absolute -top-3 left-6 rounded-full bg-brand-600 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white shadow">
                      Recommended · Complete protection
                    </span>
                    <div className="flex-1">
                      <h3 className="text-base font-semibold text-slate-900">{plan.name}</h3>
                      <p className="mt-1 text-3xl font-bold text-brand-700">
                        ₹{Number(plan.priceMonthly).toLocaleString('en-IN')}
                        <span className="text-sm font-normal text-slate-400">/mo</span>
                      </p>
                      <p className="mt-2 text-xs text-slate-500">Everything your hotel needs — distribution, operations, and the revenue leaks most owners never see.</p>
                    </div>
                    <ul className="flex-1 space-y-1.5 sm:border-l sm:border-brand-100 sm:pl-6">
                      {(PLAN_FEATURES[plan.key] ?? []).map((f, i) => (
                        <li key={f} className={`flex items-start gap-1.5 text-sm ${i === (PLAN_FEATURES[plan.key]?.length ?? 0) - 1 ? 'font-medium text-brand-700' : 'text-slate-700'}`}>
                          <span className="mt-0.5 text-brand-500">✓</span>
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                    <span className="shrink-0 rounded-lg bg-brand-600 px-5 py-2.5 text-center text-sm font-semibold text-white shadow-sm">Select this plan →</span>
                  </button>
                ))}
            </>
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
          <span className="text-lg font-semibold text-slate-900">StayYatra</span>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          {/* §user request — "ye 3 ek me hi aa jaye": the 3-way segmented button row collapsed
              into one dropdown, so the login card doesn't carry 3 always-visible tab buttons for
              a choice most people only make once. */}
          <div className="mb-5">
            <Field label="Login as">
              <select className={inputClass} value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
                {tabs.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {mode === 'signup' && selectedPlan && (
            <div className="relative mb-4 rounded-lg bg-brand-50 px-3 py-2 text-xs">
              {changingPlan ? (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setChangingPlan(false)}
                    className={`${inputClass} flex w-full items-center justify-between bg-white py-1.5 text-left text-xs`}
                  >
                    <span>
                      {selectedPlan.name} · ₹{Number(selectedPlan.priceMonthly).toLocaleString('en-IN')}/mo
                    </span>
                    <span className="text-slate-400">▲</span>
                  </button>
                  {/* Own styled panel, not a native <select> — its browser-rendered option list doesn't
                      respect our layout and can overflow a narrow signup card. */}
                  <button type="button" aria-label="Close" className="fixed inset-0 z-10 cursor-default" onClick={() => setChangingPlan(false)} />
                  <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                    {plans.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          setSelectedPlan(p);
                          setChangingPlan(false);
                        }}
                        className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-brand-50 ${
                          p.id === selectedPlan.id ? 'bg-brand-50 font-medium text-brand-700' : 'text-slate-700'
                        }`}
                      >
                        <span>{p.name}</span>
                        <span className="shrink-0 pl-3 text-slate-400">₹{Number(p.priceMonthly).toLocaleString('en-IN')}/mo</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <span className="font-medium text-brand-800">
                    {selectedPlan.name} · ₹{Number(selectedPlan.priceMonthly).toLocaleString('en-IN')}/mo
                  </span>
                  <button type="button" onClick={() => setChangingPlan(true)} className="text-brand-600 hover:underline">
                    Change plan
                  </button>
                </div>
              )}
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
                <Field label="Property ID">
                  <input
                    className={inputClass}
                    value={shortCode}
                    // §bugfix — "kabhi kabhar invalid login": shortCode is matched exactly
                    // server-side, so a pasted Property ID (WhatsApp, Notes) or a mobile keyboard's
                    // autocomplete can carry an invisible leading/trailing space that silently
                    // breaks the match. Trimming here (PIN below is already digit-only) kills that
                    // class of bug at the source.
                    onChange={(e) => setShortCode(e.target.value.toUpperCase().trim())}
                    placeholder="e.g. N2XQLJ"
                    required
                  />
                </Field>
                <Field label="PIN">
                  <input
                    className={`${inputClass} text-center text-lg tracking-[0.5em]`}
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    inputMode="numeric"
                    pattern="\d{4}"
                    placeholder="····"
                    required
                    minLength={4}
                    maxLength={4}
                  />
                </Field>
              </>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? 'Working…' : mode === 'signup' ? 'Create account' : mode === 'login' ? 'Log in' : 'Log in with PIN'}
            </Button>
            {mode === 'pin' && (
              <p className="text-center text-xs text-slate-400">
                No PIN set up yet?{' '}
                <button type="button" onClick={() => setMode('login')} className="font-medium text-brand-600 hover:underline">
                  Log in with email &amp; password
                </button>{' '}
                to set one.
              </p>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
