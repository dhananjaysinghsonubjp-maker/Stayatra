import { useEffect, useState } from 'react';
import { mutate, query, ApiError } from '../api';
import { Badge, Button, Card, Field, inputClass } from '../components/ui';

type ModuleType = 'channel_manager' | 'pms' | 'theft_protection';
const MODULE_LABEL: Record<ModuleType, string> = {
  channel_manager: 'Channel Manager',
  pms: 'PMS',
  theft_protection: 'Theft Protection',
};

interface HotelRow {
  id: string;
  name: string;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  gstRegistration: string | null;
  shortCode: string;
  _count: { rooms: number };
}

interface OrgDetail {
  id: string;
  name: string;
  suspended: boolean;
  createdAt: string;
  hotels: HotelRow[];
  modules: Record<ModuleType, boolean>;
  subscription: { planId: string; planName: string; status: string } | null;
  roomCount: number;
  staffCounts: { owners: number; generalManagers: number; frontDesk: number; housekeeping: number };
  affiliate: { id: string; name: string; brandName: string | null } | null;
}

interface PlanRow {
  id: string;
  key: string;
  name: string;
  priceMonthly: string;
}

export function AdminOrgDetail({
  organizationId,
  token,
  plans,
  onBack,
  onChanged,
}: {
  organizationId: string;
  token: string;
  plans: PlanRow[];
  onBack: () => void;
  onChanged: () => Promise<void>;
}) {
  const [org, setOrg] = useState<OrgDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedPlanKey, setSelectedPlanKey] = useState('');
  const [editingHotelId, setEditingHotelId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<HotelRow>>({});

  async function refresh() {
    try {
      const o = await query<OrgDetail>('platformAdmin.getOrganization', { organizationId }, token);
      setOrg(o);
      const currentPlan = plans.find((p) => p.id === o.subscription?.planId);
      setSelectedPlanKey(currentPlan?.key ?? '');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load organization');
    }
  }
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  async function changePlan() {
    if (!selectedPlanKey) return;
    setError(null);
    setBusy(true);
    try {
      await mutate('platformAdmin.changeOrganizationPlan', { organizationId, planKey: selectedPlanKey }, token);
      await refresh();
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to change plan');
    } finally {
      setBusy(false);
    }
  }

  function startEdit(hotel: HotelRow) {
    setEditingHotelId(hotel.id);
    setDraft({ name: hotel.name, addressLine: hotel.addressLine ?? '', city: hotel.city ?? '', state: hotel.state ?? '', pincode: hotel.pincode ?? '', gstRegistration: hotel.gstRegistration ?? '' });
  }

  async function saveHotel(hotelId: string) {
    setError(null);
    setBusy(true);
    try {
      await mutate('platformAdmin.updateHotelDetails', { hotelId, ...draft }, token);
      setEditingHotelId(null);
      await refresh();
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save hotel details');
    } finally {
      setBusy(false);
    }
  }

  if (!org) {
    return (
      <div>
        <button onClick={onBack} className="mb-4 text-sm text-brand-600 hover:underline">
          ← Back to all organizations
        </button>
        <p className="text-sm text-slate-400">{error ?? 'Loading…'}</p>
      </div>
    );
  }

  return (
    <div>
      <button onClick={onBack} className="mb-4 text-sm text-brand-600 hover:underline">
        ← Back to all organizations
      </button>

      <div className="mb-6 flex items-center gap-2">
        <h2 className="text-xl font-semibold text-slate-900">{org.name}</h2>
        {org.suspended && <Badge tone="flagged">suspended</Badge>}
        {org.affiliate && <Badge tone="slate">via {org.affiliate.name}</Badge>}
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {/* Plan */}
      <Card className="mb-4 p-5">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Plan</h3>
        <div className="mb-3 flex flex-wrap gap-2">
          {(Object.keys(MODULE_LABEL) as ModuleType[]).map((m) => (
            <span
              key={m}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ring-1 ring-inset ${
                org.modules[m] ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-500 ring-slate-300'
              }`}
            >
              {MODULE_LABEL[m]} {org.modules[m] ? '✓' : ''}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <select className={`${inputClass} w-72`} value={selectedPlanKey} onChange={(e) => setSelectedPlanKey(e.target.value)}>
            {plans.map((p) => (
              <option key={p.id} value={p.key}>
                {p.name} — ₹{Number(p.priceMonthly).toLocaleString('en-IN')}/mo
              </option>
            ))}
          </select>
          <Button variant="secondary" disabled={busy} onClick={changePlan}>
            Change plan
          </Button>
        </div>
        {org.subscription && (
          <p className="mt-2 text-xs text-slate-500">
            Currently on <span className="font-medium text-slate-700">{org.subscription.planName}</span> · {org.subscription.status}
          </p>
        )}
      </Card>

      {/* Registration source — read-only: which affiliate (if any) this hotel came through */}
      <Card className="mb-4 p-5">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Registration</h3>
        <div className="flex items-center gap-2">
          <Badge tone="slate">
            {org.affiliate ? (org.affiliate.brandName ? `White-label member of ${org.affiliate.name}` : `Affiliate member of ${org.affiliate.name}`) : 'Direct'}
          </Badge>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {org.affiliate
            ? org.affiliate.brandName
              ? `Registered as a white-label account under ${org.affiliate.name}`
              : `Referred by affiliate ${org.affiliate.name}`
            : 'Registered directly — no affiliate or reseller involved'}
        </p>
      </Card>

      {/* Stats */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="px-4 py-3">
          <p className="text-xs text-slate-500">Rooms</p>
          <p className="text-xl font-semibold text-slate-900">{org.roomCount}</p>
        </Card>
        <Card className="px-4 py-3">
          <p className="text-xs text-slate-500">General Managers</p>
          <p className="text-xl font-semibold text-slate-900">{org.staffCounts.generalManagers}</p>
        </Card>
        <Card className="px-4 py-3">
          <p className="text-xs text-slate-500">Front Desk</p>
          <p className="text-xl font-semibold text-slate-900">{org.staffCounts.frontDesk}</p>
        </Card>
        <Card className="px-4 py-3">
          <p className="text-xs text-slate-500">Housekeeping</p>
          <p className="text-xl font-semibold text-slate-900">{org.staffCounts.housekeeping}</p>
        </Card>
      </div>

      {/* Hotels / address overview */}
      <div className="space-y-3">
        {org.hotels.map((hotel) => (
          <Card key={hotel.id} className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">
                {hotel.name} <span className="font-mono text-xs font-normal text-slate-400">({hotel.shortCode})</span>
              </h3>
              {editingHotelId !== hotel.id && (
                <button onClick={() => startEdit(hotel)} className="text-xs font-medium text-brand-600 hover:underline">
                  Edit
                </button>
              )}
            </div>

            {editingHotelId === hotel.id ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Hotel name">
                    <input className={inputClass} value={draft.name ?? ''} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                  </Field>
                  <Field label="GST registration">
                    <input className={inputClass} value={draft.gstRegistration ?? ''} onChange={(e) => setDraft({ ...draft, gstRegistration: e.target.value })} />
                  </Field>
                </div>
                <Field label="Address line">
                  <input className={inputClass} value={draft.addressLine ?? ''} onChange={(e) => setDraft({ ...draft, addressLine: e.target.value })} />
                </Field>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="City">
                    <input className={inputClass} value={draft.city ?? ''} onChange={(e) => setDraft({ ...draft, city: e.target.value })} />
                  </Field>
                  <Field label="State">
                    <input className={inputClass} value={draft.state ?? ''} onChange={(e) => setDraft({ ...draft, state: e.target.value })} />
                  </Field>
                  <Field label="Pincode">
                    <input className={inputClass} value={draft.pincode ?? ''} onChange={(e) => setDraft({ ...draft, pincode: e.target.value })} />
                  </Field>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setEditingHotelId(null)}>
                    Cancel
                  </Button>
                  <Button variant="secondary" disabled={busy} onClick={() => saveHotel(hotel.id)}>
                    Save
                  </Button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-slate-600 sm:grid-cols-3">
                <p>
                  <span className="text-slate-400">Address:</span> {hotel.addressLine || '—'}
                </p>
                <p>
                  <span className="text-slate-400">City:</span> {hotel.city || '—'}
                </p>
                <p>
                  <span className="text-slate-400">State:</span> {hotel.state || '—'}
                </p>
                <p>
                  <span className="text-slate-400">Pincode:</span> {hotel.pincode || '—'}
                </p>
                <p>
                  <span className="text-slate-400">GST:</span> {hotel.gstRegistration || '—'}
                </p>
                <p>
                  <span className="text-slate-400">Rooms:</span> {hotel._count.rooms}
                </p>
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
