import { useEffect, useState } from 'react';
import { mutate, query, ApiError } from '../api';
import { useAuth } from '../AuthContext';
import { Badge, Button, Card, CardBody, CardHeader, Field, PageHeader, inputClass } from '../components/ui';
import type { InventoryRate, OtaConnection, RatePlan, RoomCategory } from '../types';

const OTA_CODES = ['mmt_goibibo', 'booking_com', 'agoda', 'cleartrip', 'expedia', 'airbnb'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function todayPlus(days: number) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

export function RateGrid({ hotelId }: { hotelId: string }) {
  const { token } = useAuth();
  const [categories, setCategories] = useState<RoomCategory[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [ratePlans, setRatePlans] = useState<RatePlan[]>([]);
  const [ratePlanId, setRatePlanId] = useState('');
  const [connections, setConnections] = useState<OtaConnection[]>([]);
  const [otaConnectionId, setOtaConnectionId] = useState('');
  const [rates, setRates] = useState<InventoryRate[]>([]);
  const [startDate, setStartDate] = useState(todayPlus(0));
  const [endDate, setEndDate] = useState(todayPlus(6));
  const [error, setError] = useState<string | null>(null);

  async function refreshConnections() {
    setConnections(await query<OtaConnection[]>('ota.listConnections', { hotelId }, token ?? undefined));
  }

  useEffect(() => {
    query<RoomCategory[]>('hotels.listRoomCategories', { hotelId }, token ?? undefined).then(setCategories);
    void refreshConnections();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId]);

  useEffect(() => {
    if (!categoryId) {
      setRatePlans([]);
      return;
    }
    query<RatePlan[]>('rates.listRatePlans', { roomCategoryId: categoryId }, token ?? undefined).then(setRatePlans);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId]);

  async function refreshGrid() {
    if (!ratePlanId || !otaConnectionId) return;
    try {
      const grid = await query<{ rates: InventoryRate[] }>(
        'rates.getGrid',
        { ratePlanId, otaConnectionId, startDate, endDate },
        token ?? undefined,
      );
      setRates(grid.rates.filter((r) => r.occupancyTier === 1));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load grid');
    }
  }
  useEffect(() => {
    void refreshGrid();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ratePlanId, otaConnectionId, startDate, endDate]);

  async function addConnection(otaCode: string) {
    await mutate('ota.createConnection', { hotelId, otaCode }, token ?? undefined);
    await refreshConnections();
  }

  async function addRatePlan(name: string) {
    if (!categoryId || !name) return;
    await mutate('rates.createRatePlan', { roomCategoryId: categoryId, name }, token ?? undefined);
    setRatePlans(await query<RatePlan[]>('rates.listRatePlans', { roomCategoryId: categoryId }, token ?? undefined));
  }

  return (
    <div>
      <PageHeader title="Rate Grid" subtitle="Channel Manager core — occupancy tier 1 shown; the API supports tiers 1–4 + extra adult/children." />

      <Card className="mb-6">
        <CardBody>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Room category">
              <select className={inputClass} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">— select —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Rate plan">
              <div className="flex gap-2">
                <select className={`${inputClass} flex-1`} value={ratePlanId} onChange={(e) => setRatePlanId(e.target.value)} disabled={!categoryId}>
                  <option value="">— select —</option>
                  {ratePlans.map((rp) => (
                    <option key={rp.id} value={rp.id}>
                      {rp.name}
                    </option>
                  ))}
                </select>
                <Button type="button" variant="secondary" disabled={!categoryId} onClick={() => addRatePlan(prompt('Rate plan name?', 'BAR') || '')}>
                  +
                </Button>
              </div>
            </Field>

            <Field label="OTA connection">
              <select className={inputClass} value={otaConnectionId} onChange={(e) => setOtaConnectionId(e.target.value)}>
                <option value="">— select —</option>
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.otaCode} ({c.status})
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Connect a channel">
              <select className={inputClass} onChange={(e) => e.target.value && addConnection(e.target.value)} value="">
                <option value="">+ Connect…</option>
                {OTA_CODES.filter((c) => !connections.some((x) => x.otaCode === c)).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="From">
              <input className={inputClass} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
            <Field label="To">
              <input className={inputClass} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </Field>

            {otaConnectionId && (
              <div className="flex items-end">
                <FullSyncButton otaConnectionId={otaConnectionId} onRefreshConnections={refreshConnections} />
              </div>
            )}
          </div>
        </CardBody>
      </Card>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {ratePlanId && otaConnectionId && (
        <div className="space-y-6">
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs font-medium text-slate-500">
                    <th className="px-5 py-3">Date</th>
                    <th className="px-5 py-3">Price</th>
                    <th className="px-5 py-3">Availability</th>
                    <th className="px-5 py-3">Source</th>
                    <th className="px-5 py-3">GST</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rates.map((r) => (
                    <tr key={r.id}>
                      <td className="px-5 py-3 text-slate-700">{r.date.slice(0, 10)}</td>
                      <td className="px-5 py-3 font-medium text-slate-900">₹{r.price}</td>
                      <td className="px-5 py-3 text-slate-500">{r.availability}</td>
                      <td className="px-5 py-3">
                        <Badge tone={r.source}>{r.source}</Badge>
                      </td>
                      <td className="px-5 py-3 text-slate-500">{r.gst.label}</td>
                    </tr>
                  ))}
                  {rates.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-5 py-6 text-center text-sm text-slate-400">
                        No rates set for this range yet — use Bulk Update below.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <BulkUpdateForm ratePlanId={ratePlanId} otaConnectionId={otaConnectionId} onDone={refreshGrid} />
          <ValueOverrideForm ratePlanId={ratePlanId} otaConnectionId={otaConnectionId} onDone={refreshGrid} />
        </div>
      )}
    </div>
  );
}

function BulkUpdateForm({
  ratePlanId,
  otaConnectionId,
  onDone,
}: {
  ratePlanId: string;
  otaConnectionId: string;
  onDone: () => void;
}) {
  const { token } = useAuth();
  const [startDate, setStartDate] = useState(todayPlus(0));
  const [endDate, setEndDate] = useState(todayPlus(6));
  const [days, setDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [price, setPrice] = useState(3000);
  const [availability, setAvailability] = useState(5);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggleDay(d: number) {
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await mutate<{ datesProcessed: number; cellsUpdated: number; cellsSkippedValueOverride: number }>(
        'rates.bulkUpdate',
        {
          ratePlanId,
          otaConnectionId,
          startDate,
          endDate,
          daysOfWeek: days.length === 7 ? undefined : days,
          explicitTiers: [{ occupancyTier: 1, price, availability }],
        },
        token ?? undefined,
      );
      setResult(`Updated ${res.cellsUpdated} cells across ${res.datesProcessed} dates (${res.cellsSkippedValueOverride} skipped — value override)`);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Bulk update failed');
    }
  }

  return (
    <Card>
      <CardHeader title="Bulk Update" />
      <CardBody>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Field label="From">
              <input className={inputClass} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
            <Field label="To">
              <input className={inputClass} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </Field>
            <Field label="Price (tier 1)">
              <input className={inputClass} type="number" value={price} onChange={(e) => setPrice(Number(e.target.value))} min={0} />
            </Field>
            <Field label="Availability">
              <input className={inputClass} type="number" value={availability} onChange={(e) => setAvailability(Number(e.target.value))} min={0} />
            </Field>
          </div>
          <div className="flex flex-wrap gap-3">
            {DOW.map((label, i) => (
              <label key={i} className="flex items-center gap-1.5 text-sm text-slate-600">
                <input type="checkbox" checked={days.includes(i)} onChange={() => toggleDay(i)} className="rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
                {label}
              </label>
            ))}
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {result && <p className="text-sm text-emerald-600">{result}</p>}
          <Button type="submit" variant="secondary">
            Apply bulk update
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

function ValueOverrideForm({
  ratePlanId,
  otaConnectionId,
  onDone,
}: {
  ratePlanId: string;
  otaConnectionId: string;
  onDone: () => void;
}) {
  const { token } = useAuth();
  const [date, setDate] = useState(todayPlus(2));
  const [price, setPrice] = useState(8500);
  const [availability, setAvailability] = useState(3);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);
    try {
      await mutate(
        'rates.setValueOverride',
        { ratePlanId, otaConnectionId, date, tiers: [{ occupancyTier: 1, price, availability }] },
        token ?? undefined,
      );
      setDone(true);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Value override failed');
    }
  }

  return (
    <Card>
      <CardHeader title="Value Override" subtitle="A one-time rate float — bulk updates skip this cell until explicitly told to override it." />
      <CardBody>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <Field label="Date">
              <input className={inputClass} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Price (tier 1)">
              <input className={inputClass} type="number" value={price} onChange={(e) => setPrice(Number(e.target.value))} min={0} />
            </Field>
            <Field label="Availability">
              <input className={inputClass} type="number" value={availability} onChange={(e) => setAvailability(Number(e.target.value))} min={0} />
            </Field>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {done && <p className="text-sm text-emerald-600">Override applied.</p>}
          <Button type="submit" variant="secondary">
            Set value override
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

function FullSyncButton({ otaConnectionId, onRefreshConnections }: { otaConnectionId: string; onRefreshConnections: () => void }) {
  const { token } = useAuth();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      await mutate('ota.fullSync', { otaConnectionId }, token ?? undefined);
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 500));
        onRefreshConnections();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button type="button" variant="secondary" onClick={run} disabled={busy} className="w-full">
      {busy ? 'Syncing…' : 'Full Sync'}
    </Button>
  );
}
