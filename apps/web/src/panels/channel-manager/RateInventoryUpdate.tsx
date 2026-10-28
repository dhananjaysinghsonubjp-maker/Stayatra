import { useEffect, useMemo, useState } from 'react';
import { mutate, query, ApiError } from '../../api';
import { useAuth } from '../../AuthContext';
import { Button, Card, PageHeader, inputClass } from '../../components/ui';
import type { InventoryRate, OtaConnection, RatePlan, RoomCategoryDetail } from '../../types';

const WINDOW_DAYS = 4;

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function addDaysISO(iso: string, days: number) {
  return new Date(new Date(`${iso}T00:00:00`).getTime() + days * 86400000).toISOString().slice(0, 10);
}
function dowLabel(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short' });
}
function dayNumber(iso: string) {
  return iso.slice(8, 10);
}
function rangeLabel(days: string[]) {
  const opt: Intl.DateTimeFormatOptions = { month: 'short', day: '2-digit' };
  const start = new Date(`${days[0]}T00:00:00`).toLocaleDateString('en-US', opt);
  const end = new Date(`${days[days.length - 1]}T00:00:00`);
  return `${start} - ${end.toLocaleDateString('en-US', opt)}, ${end.getFullYear()}`;
}

interface DayCell {
  rate: string;
  inventory: string;
  available: number;
}

/**
 * §user request — "Bulk Update ka naam Room Management ho, uske under Rate & Invt. Update":
 * a simpler category-wise rate+inventory grid than the existing Rate Update/Inventory Update
 * pages — no channel picker (§user decision: writes go to every connected OTA channel at once,
 * not a chosen subset), no discount (replaced with Inventory), one row per room category instead
 * of per rate plan (a category's first rate plan is treated as "the" plan this tool edits).
 */
export function RateInventoryUpdate({ hotelId }: { hotelId: string }) {
  const { token } = useAuth();
  const [categories, setCategories] = useState<RoomCategoryDetail[]>([]);
  const [ratePlans, setRatePlans] = useState<RatePlan[]>([]);
  const [connections, setConnections] = useState<OtaConnection[]>([]);
  const [loadingBase, setLoadingBase] = useState(true);
  const [loadingCells, setLoadingCells] = useState(false);
  const [filterCategoryId, setFilterCategoryId] = useState('all');
  const [windowStart, setWindowStart] = useState(todayISO());
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [cells, setCells] = useState<Record<string, DayCell>>({});
  const [dirty, setDirty] = useState<Record<string, true>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const days = useMemo(() => Array.from({ length: WINDOW_DAYS }, (_, i) => addDaysISO(windowStart, i)), [windowStart]);

  useEffect(() => {
    async function load() {
      const [cats, rp, conns] = await Promise.all([
        query<{ id: string }[]>('hotels.listRoomCategories', { hotelId }, token ?? undefined),
        query<RatePlan[]>('rates.listAllRatePlansForHotel', { hotelId }, token ?? undefined),
        query<OtaConnection[]>('ota.listConnections', { hotelId }, token ?? undefined),
      ]);
      const details = await Promise.all(
        cats.map((c) => query<RoomCategoryDetail>('hotels.getRoomCategoryDetail', { roomCategoryId: c.id }, token ?? undefined)),
      );
      setCategories(details.filter((d) => d.active));
      setRatePlans(rp);
      setConnections(conns);
      setLoadingBase(false);
    }
    void load();
  }, [hotelId, token]);

  // One rate plan per category — its first one, matching this tool's one-row-per-category layout.
  const planForCategory = useMemo(() => {
    const map = new Map<string, RatePlan>();
    for (const c of categories) {
      const rp = ratePlans.find((p) => p.roomCategoryId === c.id);
      if (rp) map.set(c.id, rp);
    }
    return map;
  }, [categories, ratePlans]);

  const visibleCategories = filterCategoryId === 'all' ? categories : categories.filter((c) => c.id === filterCategoryId);

  useEffect(() => {
    async function loadCells() {
      if (connections.length === 0 || planForCategory.size === 0) return;
      setLoadingCells(true);
      // Representative read — every connected channel gets written the same values on Apply
      // (§user decision), so any one channel's current cells are a fair starting point to show.
      const otaConnectionId = connections[0].id;
      const startDate = days[0];
      const endDate = days[days.length - 1];
      const next: Record<string, DayCell> = {};
      await Promise.all(
        Array.from(planForCategory.values()).map(async (rp) => {
          const grid = await query<{ rates: InventoryRate[] }>(
            'rates.getGrid',
            { ratePlanId: rp.id, otaConnectionId, startDate, endDate },
            token ?? undefined,
          );
          for (const date of days) {
            const dayRows = grid.rates.filter((r) => r.date.slice(0, 10) === date);
            const tier1 = dayRows.find((r) => r.occupancyTier === 1) ?? dayRows[0];
            next[`${rp.id}:${date}`] = {
              rate: tier1 ? String(Math.round(Number(tier1.price))) : '',
              inventory: tier1 ? String(tier1.availability) : '',
              available: tier1 ? tier1.availability : 0,
            };
          }
        }),
      );
      setCells(next);
      setDirty({});
      setLoadingCells(false);
    }
    void loadCells();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connections, planForCategory, windowStart]);

  function cellKey(ratePlanId: string, date: string) {
    return `${ratePlanId}:${date}`;
  }
  function setField(ratePlanId: string, date: string, field: 'rate' | 'inventory', value: string) {
    const key = cellKey(ratePlanId, date);
    setCells((prev) => ({ ...prev, [key]: { ...(prev[key] ?? { rate: '', inventory: '', available: 0 }), [field]: value } }));
    setDirty((prev) => ({ ...prev, [key]: true }));
  }

  const dirtyCount = Object.keys(dirty).length;

  async function applyChanges() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      let cellsUpdated = 0;
      for (const key of Object.keys(dirty)) {
        const [ratePlanId, date] = key.split(':');
        const cell = cells[key];
        if (!cell) continue;
        // §bugfix — this used to require Rate to be non-blank or silently skip the whole cell,
        // so an Inventory-only edit on a date with no price set yet (nothing fetched to prefill
        // Rate) never actually saved, with no error shown — looked like the inventory number
        // just didn't "take." Price and availability are independent now; only skip if neither
        // was actually touched.
        const price = cell.rate === '' ? undefined : Number(cell.rate);
        const availability = cell.inventory === '' ? undefined : Number(cell.inventory);
        if (price === undefined && availability === undefined) continue;
        const explicitTiers = [1, 2].map((occupancyTier) => ({ occupancyTier, price, availability }));
        for (const conn of connections) {
          await mutate('rates.bulkUpdate', { ratePlanId, otaConnectionId: conn.id, startDate: date, endDate: date, explicitTiers }, token ?? undefined);
        }
        cellsUpdated++;
        if (availability !== undefined) {
          setCells((prev) => ({ ...prev, [key]: { ...prev[key], available: availability } }));
        }
      }
      setResult(`Updated ${cellsUpdated} date(s) across ${connections.length} channel(s).`);
      setDirty({});
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  if (loadingBase) return <div className="p-6 text-sm text-slate-400">Loading…</div>;

  if (connections.length === 0) {
    return (
      <Card className="p-6 text-center text-sm text-slate-400">
        Connect at least one OTA channel first (Connected Channels) — rate and inventory updates go out to every connected channel at once.
      </Card>
    );
  }
  if (planForCategory.size === 0) {
    return <Card className="p-6 text-center text-sm text-slate-400">No rate plans yet — create one on Linked Rate Plan first.</Card>;
  }

  return (
    <div>
      <PageHeader
        title="Rate & Inventory Update"
        subtitle="Category-wise rates and room availability, a few days at a time — updates go out to every connected channel at once."
      />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <select className={`${inputClass} w-56`} value={filterCategoryId} onChange={(e) => setFilterCategoryId(e.target.value)}>
          <option value="all">All Room Types</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setWindowStart((w) => addDaysISO(w, -WINDOW_DAYS))}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
            aria-label="Previous"
          >
            ←
          </button>
          <div className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-900">{rangeLabel(days)}</div>
          <button
            type="button"
            onClick={() => setWindowStart((w) => addDaysISO(w, WINDOW_DAYS))}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
            aria-label="Next"
          >
            →
          </button>
        </div>
      </div>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {result && <p className="mb-3 text-sm text-emerald-600">{result}</p>}

      <div className="space-y-4">
        {visibleCategories.map((cat) => {
          const rp = planForCategory.get(cat.id);
          if (!rp) return null;
          const isCollapsed = collapsed[cat.id] ?? false;
          const baseCell = cells[cellKey(rp.id, days[0])];
          return (
            <Card key={cat.id} className="overflow-hidden p-0">
              <button
                type="button"
                onClick={() => setCollapsed((prev) => ({ ...prev, [cat.id]: !isCollapsed }))}
                className="flex w-full items-center gap-2 border-b border-slate-100 bg-brand-50 px-5 py-3 text-left"
              >
                <span className={`text-slate-500 transition-transform ${isCollapsed ? '-rotate-90' : ''}`}>⌃</span>
                <span className="text-sm font-bold text-slate-900">{cat.name}</span>
              </button>

              {!isCollapsed && (
                <div className="flex flex-wrap gap-4 p-5">
                  <div className="w-44 shrink-0 rounded-xl border border-dashed border-amber-200 bg-amber-50/50 p-4">
                    <p className="flex items-center gap-1.5 text-sm font-bold text-slate-900">📦 {cat.name}</p>
                    <p className="mt-2 text-xs text-slate-500">
                      Base: <span className="font-semibold text-slate-700">₹{baseCell?.rate || '—'}</span>
                    </p>
                  </div>

                  {loadingCells
                    ? Array.from({ length: WINDOW_DAYS }, (_, i) => <div key={i} className="h-56 w-52 animate-pulse rounded-xl bg-slate-100" />)
                    : days.map((date) => {
                        const key = cellKey(rp.id, date);
                        const cell = cells[key] ?? { rate: '', inventory: '', available: 0 };
                        return (
                          <div key={date} className="w-52 shrink-0 rounded-xl border border-slate-200 p-3">
                            <div className="mb-3 flex items-center gap-1.5 rounded-lg bg-slate-50 px-2 py-1.5 text-sm font-semibold text-slate-700">
                              📅 {dowLabel(date)} <span className="ml-auto text-base font-bold text-slate-900">{dayNumber(date)}</span>
                            </div>

                            <p className="mb-1 text-xs font-medium text-slate-600">₹ Rate</p>
                            <input
                              className={`${inputClass} mb-2.5 w-full`}
                              type="number"
                              min={0}
                              value={cell.rate}
                              onChange={(e) => setField(rp.id, date, 'rate', e.target.value)}
                            />

                            <p className="mb-1 text-xs font-medium text-slate-600">Inventory</p>
                            <input
                              className={`${inputClass} mb-2.5 w-full`}
                              type="number"
                              min={0}
                              max={cat.roomCount}
                              value={cell.inventory}
                              onChange={(e) => setField(rp.id, date, 'inventory', e.target.value)}
                            />

                            <span className="mb-2 inline-block rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
                              🛏️ {cell.available} / {cat.roomCount} Available
                            </span>
                            <p className="mb-2 text-[11px] text-slate-400">Inclusive of all taxes</p>

                            <div className="flex items-center justify-between rounded-lg bg-brand-50 px-2.5 py-2">
                              <span className="text-xs font-semibold text-slate-600">Final Rate</span>
                              <span className="text-sm font-bold text-brand-700">₹{cell.rate || 0}</span>
                            </div>
                          </div>
                        );
                      })}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <div className="sticky bottom-0 mt-6 flex items-center justify-end gap-3 border-t border-slate-200 bg-white/95 py-4 backdrop-blur">
        {dirtyCount > 0 && <span className="text-xs text-slate-500">{dirtyCount} change{dirtyCount === 1 ? '' : 's'} pending</span>}
        <Button type="button" disabled={dirtyCount === 0 || busy} onClick={applyChanges}>
          {busy ? 'Applying…' : 'Apply Changes'}
        </Button>
      </div>
    </div>
  );
}
