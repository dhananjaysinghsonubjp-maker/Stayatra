import { useEffect, useState } from 'react';
import { mutate, query, ApiError } from '../api';
import { Badge, Card, EmptyState } from '../components/ui';
import type { ActingAffiliate } from './AffiliateApp';

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
}

export function AffiliateDashboard({ affiliate, token, onLogout }: { affiliate: ActingAffiliate; token: string; onLogout: () => void }) {
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyOrgId, setBusyOrgId] = useState<string | null>(null);
  const accent = affiliate.primaryColor ?? '#4f46e5';

  async function refresh() {
    try {
      setOrgs(await query<OrgRow[]>('affiliate.listOrganizations', undefined, token));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load your hotels');
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
      await mutate('affiliate.setModuleEnabled', { organizationId: orgId, module, enabled }, token);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update module');
    } finally {
      setBusyOrgId(null);
    }
  }

  async function toggleSuspended(orgId: string, suspended: boolean) {
    if (suspended && !confirm('Suspend this hotel? Every user in it will be signed out and blocked from logging in.')) return;
    setError(null);
    setBusyOrgId(orgId);
    try {
      await mutate('affiliate.setSuspended', { organizationId: orgId, suspended }, token);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update suspension state');
    } finally {
      setBusyOrgId(null);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="h-1.5" style={{ backgroundColor: accent }} />
      <div className="border-b border-slate-200 bg-white px-8 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-3">
            {affiliate.logoUrl && <img src={affiliate.logoUrl} alt="" className="h-9 w-9 rounded object-contain" />}
            <div>
              <h1 className="text-lg font-semibold text-slate-900">{affiliate.brandName ?? affiliate.name}</h1>
              <p className="text-xs text-slate-500">{affiliate.email}</p>
            </div>
          </div>
          <button onClick={onLogout} className="text-sm text-slate-500 hover:text-slate-700">
            Log out
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-8 py-8">
        <div className="mb-6 flex gap-3">
          <Card className="px-5 py-3">
            <p className="text-xs text-slate-500">Hotels referred</p>
            <p className="text-xl font-semibold text-slate-900">{orgs.length}</p>
          </Card>
          <Card className="px-5 py-3">
            <p className="text-xs text-slate-500">Suspended</p>
            <p className={`text-xl font-semibold ${orgs.some((o) => o.suspended) ? 'text-red-600' : 'text-slate-900'}`}>
              {orgs.filter((o) => o.suspended).length}
            </p>
          </Card>
        </div>

        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        {orgs.length === 0 ? (
          <EmptyState title="No hotels referred yet" hint="A platform admin assigns organizations to you" />
        ) : (
          <div className="space-y-3">
            {orgs.map((org) => (
              <Card key={org.id} className={`p-5 ${org.suspended ? 'border-red-200 bg-red-50/40' : ''}`}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-slate-900">{org.name}</h3>
                      {org.suspended && <Badge tone="flagged">suspended</Badge>}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {org.hotels.length} hotel{org.hotels.length === 1 ? '' : 's'} · {org.staffCount} staff · created{' '}
                      {org.createdAt.slice(0, 10)}
                    </p>
                    {org.hotels.length > 0 && (
                      <p className="mt-1 text-xs text-slate-400">{org.hotels.map((h) => `${h.name} (${h.shortCode})`).join(', ')}</p>
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

                <div className="mt-3 flex flex-wrap gap-2">
                  {(Object.keys(MODULE_LABEL) as ModuleType[]).map((m) => (
                    <button
                      key={m}
                      disabled={busyOrgId === org.id}
                      onClick={() => toggleModule(org.id, m, !org.modules[m])}
                      className="rounded-full px-3 py-1.5 text-xs font-medium ring-1 ring-inset transition-colors disabled:opacity-50"
                      style={
                        org.modules[m]
                          ? { backgroundColor: accent, color: 'white', boxShadow: `inset 0 0 0 1px ${accent}` }
                          : { backgroundColor: 'white', color: '#64748b', boxShadow: 'inset 0 0 0 1px #cbd5e1' }
                      }
                    >
                      {MODULE_LABEL[m]} {org.modules[m] ? '✓' : ''}
                    </button>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
