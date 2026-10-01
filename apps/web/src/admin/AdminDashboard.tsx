import { useEffect, useState } from 'react';
import { mutate, query, ApiError } from '../api';
import { Badge, Button, Card, EmptyState, Field, inputClass } from '../components/ui';
import { AdminOrgDetail } from './AdminOrgDetail';
import type { PlatformAdmin } from './AdminApp';

type ModuleType = 'channel_manager' | 'pms' | 'theft_protection';
const MODULE_LABEL: Record<ModuleType, string> = {
  channel_manager: 'Channel Manager',
  pms: 'PMS',
  theft_protection: 'Theft Protection',
};

interface OrgRow {
  id: string;
  name: string;
  planTier: string | null;
  suspended: boolean;
  createdAt: string;
  hotels: { id: string; name: string; shortCode: string }[];
  staffCount: number;
  modules: Record<ModuleType, boolean>;
  affiliate: { id: string; name: string; brandName: string | null } | null;
  subscription: { planName: string; status: string } | null;
}

interface AffiliateRow {
  id: string;
  name: string;
  email: string;
  commissionRate: string | null;
  brandName: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
  createdAt: string;
  referredCount: number;
}

interface PlanRow {
  id: string;
  key: string;
  name: string;
  description: string;
  modules: ModuleType[];
  priceMonthly: string;
}

export function AdminDashboard({ admin, token, onLogout }: { admin: PlatformAdmin; token: string; onLogout: () => void }) {
  const [tab, setTab] = useState<'orgs' | 'affiliates' | 'plans'>('orgs');
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [affiliates, setAffiliates] = useState<AffiliateRow[]>([]);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyOrgId, setBusyOrgId] = useState<string | null>(null);
  const [viewingOrgId, setViewingOrgId] = useState<string | null>(null);

  async function refresh() {
    try {
      const [o, a, p] = await Promise.all([
        query<OrgRow[]>('platformAdmin.listOrganizations', undefined, token),
        query<AffiliateRow[]>('platformAdmin.listAffiliates', undefined, token),
        query<PlanRow[]>('plans.list', undefined, token),
      ]);
      setOrgs(o);
      setAffiliates(a);
      setPlans(p);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load data');
    }
  }
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleModule(orgId: string, module: ModuleType, enabled: boolean) {
    setError(null);
    setBusyOrgId(orgId);
    try {
      await mutate('platformAdmin.setModuleEnabled', { organizationId: orgId, module, enabled }, token);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update module');
    } finally {
      setBusyOrgId(null);
    }
  }

  async function toggleSuspended(orgId: string, suspended: boolean) {
    if (suspended && !confirm('Suspend this organization? Every user in it will be signed out and blocked from logging in.')) return;
    setError(null);
    setBusyOrgId(orgId);
    try {
      await mutate('platformAdmin.setSuspended', { organizationId: orgId, suspended }, token);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update suspension state');
    } finally {
      setBusyOrgId(null);
    }
  }

  const totals = {
    organizations: orgs.length,
    hotels: orgs.reduce((sum, o) => sum + o.hotels.length, 0),
    suspended: orgs.filter((o) => o.suspended).length,
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="border-b border-slate-200 bg-white px-8 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Platform Admin</h1>
            <p className="text-xs text-slate-500">{admin.name} · {admin.email}</p>
          </div>
          <button onClick={onLogout} className="text-sm text-slate-500 hover:text-slate-700">
            Log out
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-8 py-8">
        {viewingOrgId ? (
          <AdminOrgDetail
            organizationId={viewingOrgId}
            token={token}
            plans={plans}
            onBack={() => setViewingOrgId(null)}
            onChanged={refresh}
          />
        ) : (
          <>
        <div className="mb-6 flex gap-3">
          <Card className="px-5 py-3">
            <p className="text-xs text-slate-500">Organizations</p>
            <p className="text-xl font-semibold text-slate-900">{totals.organizations}</p>
          </Card>
          <Card className="px-5 py-3">
            <p className="text-xs text-slate-500">Hotels</p>
            <p className="text-xl font-semibold text-slate-900">{totals.hotels}</p>
          </Card>
          <Card className="px-5 py-3">
            <p className="text-xs text-slate-500">Suspended</p>
            <p className={`text-xl font-semibold ${totals.suspended > 0 ? 'text-red-600' : 'text-slate-900'}`}>{totals.suspended}</p>
          </Card>
          <Card className="px-5 py-3">
            <p className="text-xs text-slate-500">Affiliates</p>
            <p className="text-xl font-semibold text-slate-900">{affiliates.length}</p>
          </Card>
        </div>

        <div className="mb-5 flex rounded-lg bg-slate-100 p-1 sm:w-80">
          <button
            onClick={() => setTab('orgs')}
            className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${tab === 'orgs' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
          >
            Organizations
          </button>
          <button
            onClick={() => setTab('affiliates')}
            className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${tab === 'affiliates' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
          >
            Affiliates
          </button>
          <button
            onClick={() => setTab('plans')}
            className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${tab === 'plans' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
          >
            Plans
          </button>
        </div>

        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        {tab === 'orgs' &&
          (orgs.length === 0 ? (
            <EmptyState title="No organizations yet" />
          ) : (
            <div className="space-y-3">
              {orgs.map((org) => (
                <Card key={org.id} className={`p-5 ${org.suspended ? 'border-red-200 bg-red-50/40' : ''}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setViewingOrgId(org.id)}
                          className="text-sm font-semibold text-slate-900 hover:text-brand-600 hover:underline"
                        >
                          {org.name}
                        </button>
                        {org.suspended && <Badge tone="flagged">suspended</Badge>}
                        <Badge tone="slate">
                          {org.affiliate ? (org.affiliate.brandName ? `White-label via ${org.affiliate.name}` : `via ${org.affiliate.name}`) : 'Direct'}
                        </Badge>
                        {org.subscription && (
                          <Badge tone={org.subscription.status === 'active' ? 'available' : 'occupied'}>
                            {org.subscription.planName} · {org.subscription.status}
                          </Badge>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {org.hotels.length} hotel{org.hotels.length === 1 ? '' : 's'} · {org.staffCount} staff · created{' '}
                        {org.createdAt.slice(0, 10)}
                      </p>
                      {org.hotels.length > 0 && (
                        <p className="mt-1 text-xs text-slate-400">
                          {org.hotels.map((h) => `${h.name} (${h.shortCode})`).join(', ')}
                        </p>
                      )}
                    </div>
                    <button
                      disabled={busyOrgId === org.id}
                      onClick={() => toggleSuspended(org.id, !org.suspended)}
                      className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium ring-1 ring-inset transition-colors disabled:opacity-50 ${
                        org.suspended ? 'bg-emerald-600 text-white ring-emerald-600 hover:bg-emerald-700' : 'bg-white text-red-600 ring-red-300 hover:bg-red-50'
                      }`}
                    >
                      {org.suspended ? 'Reactivate' : 'Suspend'}
                    </button>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {(Object.keys(MODULE_LABEL) as ModuleType[]).map((m) => (
                      <button
                        key={m}
                        disabled={busyOrgId === org.id}
                        onClick={() => toggleModule(org.id, m, !org.modules[m])}
                        className={`rounded-full px-3 py-1.5 text-xs font-medium ring-1 ring-inset transition-colors disabled:opacity-50 ${
                          org.modules[m] ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-500 ring-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        {MODULE_LABEL[m]} {org.modules[m] ? '✓' : ''}
                      </button>
                    ))}
                  </div>
                </Card>
              ))}
            </div>
          ))}

        {tab === 'affiliates' && <AffiliatesTab affiliates={affiliates} token={token} onChanged={refresh} setError={setError} />}

        {tab === 'plans' && <PlansTab plans={plans} token={token} onChanged={refresh} setError={setError} />}
          </>
        )}
      </div>
    </div>
  );
}

function AffiliatesTab({
  affiliates,
  token,
  onChanged,
  setError,
}: {
  affiliates: AffiliateRow[];
  token: string;
  onChanged: () => Promise<void>;
  setError: (e: string | null) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [commissionRate, setCommissionRate] = useState<number | ''>('');
  const [brandName, setBrandName] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#4f46e5');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await mutate(
        'platformAdmin.createAffiliate',
        {
          name,
          email,
          password,
          commissionRate: commissionRate === '' ? undefined : commissionRate,
          brandName: brandName || undefined,
          logoUrl: logoUrl || undefined,
          primaryColor: primaryColor || undefined,
        },
        token,
      );
      setName('');
      setEmail('');
      setPassword('');
      setCommissionRate('');
      setBrandName('');
      setLogoUrl('');
      setShowForm(false);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create affiliate');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <Button variant={showForm ? 'secondary' : 'primary'} onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Cancel' : '+ New affiliate'}
        </Button>
      </div>

      {showForm && (
        <Card className="mb-4 p-5">
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label="Partner name">
                <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required />
              </Field>
              <Field label="Login email">
                <input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </Field>
              <Field label="Password">
                <input className={inputClass} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
              </Field>
              <Field label="Commission % (tracking only)">
                <input
                  className={inputClass}
                  type="number"
                  value={commissionRate}
                  onChange={(e) => setCommissionRate(e.target.value === '' ? '' : Number(e.target.value))}
                  min={0}
                  max={100}
                  placeholder="e.g. 10"
                />
              </Field>
              <Field label="Portal brand name">
                <input className={inputClass} value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder="Shown instead of their own name" />
              </Field>
              <Field label="Logo URL">
                <input className={inputClass} value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://…" />
              </Field>
              <Field label="Portal accent color">
                <input className={`${inputClass} h-10 p-1`} type="color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} />
              </Field>
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={busy}>
                {busy ? 'Creating…' : 'Create affiliate'}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {affiliates.length === 0 ? (
        <EmptyState title="No affiliates yet" hint="Create one to start referring hotels through a reseller/white-label partner" />
      ) : (
        <div className="space-y-3">
          {affiliates.map((a) => (
            <Card key={a.id} className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                {a.logoUrl && <img src={a.logoUrl} alt="" className="h-8 w-8 rounded object-contain" />}
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    {a.name} {a.brandName && <span className="text-slate-400">— "{a.brandName}"</span>}
                  </p>
                  <p className="text-xs text-slate-500">
                    {a.email} · {a.referredCount} hotel{a.referredCount === 1 ? '' : 's'} referred
                    {a.commissionRate ? ` · ${a.commissionRate}% commission (tracking only)` : ''}
                  </p>
                </div>
              </div>
              {a.primaryColor && <span className="h-6 w-6 rounded-full ring-1 ring-inset ring-slate-200" style={{ backgroundColor: a.primaryColor }} />}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function PlansTab({
  plans,
  token,
  onChanged,
  setError,
}: {
  plans: PlanRow[];
  token: string;
  onChanged: () => Promise<void>;
  setError: (e: string | null) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftPrice, setDraftPrice] = useState<number>(0);
  const [busy, setBusy] = useState(false);

  async function save(planId: string) {
    setError(null);
    setBusy(true);
    try {
      await mutate('plans.updatePrice', { planId, priceMonthly: draftPrice }, token);
      setEditingId(null);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update price');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="mb-1 text-xs text-slate-400">Shown on the public signup page — these are the placeholder prices, edit them once real numbers exist.</p>
      {plans.map((plan) => (
        <Card key={plan.id} className="flex items-center justify-between p-4">
          <div>
            <p className="text-sm font-semibold text-slate-900">{plan.name}</p>
            <p className="text-xs text-slate-500">{plan.description}</p>
            <p className="mt-1 text-xs text-slate-400">Modules: {plan.modules.join(', ')}</p>
          </div>
          {editingId === plan.id ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-500">₹</span>
              <input
                className={`${inputClass} w-28`}
                type="number"
                value={draftPrice}
                onChange={(e) => setDraftPrice(Number(e.target.value))}
                min={0}
                autoFocus
              />
              <Button variant="secondary" disabled={busy} onClick={() => save(plan.id)}>
                Save
              </Button>
              <Button variant="ghost" onClick={() => setEditingId(null)}>
                Cancel
              </Button>
            </div>
          ) : (
            <button
              onClick={() => {
                setEditingId(plan.id);
                setDraftPrice(Number(plan.priceMonthly));
              }}
              className="text-lg font-bold text-slate-900 hover:text-brand-600"
              title="Click to edit"
            >
              ₹{Number(plan.priceMonthly).toLocaleString('en-IN')}
              <span className="text-xs font-normal text-slate-400">/mo</span>
            </button>
          )}
        </Card>
      ))}
    </div>
  );
}
