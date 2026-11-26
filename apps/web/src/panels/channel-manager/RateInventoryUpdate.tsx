import { useEffect, useMemo, useState } from 'react';
import { mutate, query, ApiError } from '../../api';
import { useAuth } from '../../AuthContext';
import { Button, Card, CardBody, CardHeader, Field, PageHeader, inputClass } from '../../components/ui';
import type { Tab } from '../../layout/Sidebar';
import type { InventoryRate, OtaConnection, RatePlan, RoomCategory, RoomCategoryDetail } from '../../types';

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
// §user request — "humara Rate and Inventory Update mein poora create karo": a reference app's
// own Room Rate Management shows a whole calendar month at a time (prev/next MONTH, not a small
// rolling window) rather than this tool's old 4-day slice.
function firstOfMonth(iso: string) {
  return `${iso.slice(0, 7)}-01`;
}
function daysInMonthCount(iso: string) {
  const [y, m] = iso.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}
function addMonthsISO(iso: string, months: number) {
  const [y, m] = iso.split('-').map(Number);
  const d = new Date(y, m - 1 + months, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
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
export function RateInventoryUpdate({ hotelId, onNavigate }: { hotelId: string; onNavigate?: (tab: Tab) => void }) {
  const { token } = useAuth();
  const [categories, setCategories] = useState<RoomCategoryDetail[]>([]);
  const [ratePlans, setRatePlans] = useState<RatePlan[]>([]);
  const [connections, setConnections] = useState<OtaConnection[]>([]);
  const [loadingBase, setLoadingBase] = useState(true);
  const [loadingCells, setLoadingCells] = useState(false);
  const [filterCategoryId, setFilterCategoryId] = useState('all');
  const [monthStart, setMonthStart] = useState(firstOfMonth(todayISO()));
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [cells, setCells] = useState<Record<string, DayCell>>({});
  const [dirty, setDirty] = useState<Record<string, true>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [cellsRefreshKey, setCellsRefreshKey] = useState(0);

  // §user request, with a reference app's own "Bulk Update" panel as the target — Modification
  // Rule (Set Value / Increase by / Decrease by, see rates.service.ts's own comment on
  // createRateChangeRequest for what Increase/Decrease actually do) + an optional Discount(%) on
  // top, across a date range, for one or more room types at once. Goes through
  // rates.createRateChangeRequest rather than writing cells directly — a manager's submission
  // waits for an owner's approval (Approval Requests), an owner's own applies right away.
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkRoomTypes, setBulkRoomTypes] = useState<string[]>([]);
  const [bulkStart, setBulkStart] = useState(todayISO());
  const [bulkEnd, setBulkEnd] = useState(addDaysISO(todayISO(), 6));
  const [bulkRule, setBulkRule] = useState<'set' | 'increase' | 'decrease'>('set');
  const [bulkValue, setBulkValue] = useState('');
  const [bulkDiscount, setBulkDiscount] = useState('');
  const [bulkRemarks, setBulkRemarks] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkResult, setBulkResult] = useState<string | null>(null);

  const days = useMemo(() => {
    const count = daysInMonthCount(monthStart);
    return Array.from({ length: count }, (_, i) => addDaysISO(monthStart, i));
  }, [monthStart]);

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
  }, [connections, planForCategory, monthStart, cellsRefreshKey]);

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
        // §bugfix — the backend now fans availability out to every connected channel on its own
        // (rates.service.ts's setValueOverride/bulkUpdate), so sending it again on every
        // connection here was writing each cell 3x for no reason (once directly, twice more as
        // the backend's own fan-out from the other two calls). Availability only needs to be
        // sent once; price (which the backend deliberately leaves per-channel) still goes to
        // every connection explicitly, since this tool's whole point is one master price too.
        await mutate(
          'rates.bulkUpdate',
          { ratePlanId, otaConnectionId: connections[0].id, startDate: date, endDate: date, explicitTiers: [1, 2].map((occupancyTier) => ({ occupancyTier, price, availability })) },
          token ?? undefined,
        );
        if (price !== undefined) {
          for (const conn of connections.slice(1)) {
            await mutate(
              'rates.bulkUpdate',
              { ratePlanId, otaConnectionId: conn.id, startDate: date, endDate: date, explicitTiers: [1, 2].map((occupancyTier) => ({ occupancyTier, price })) },
              token ?? undefined,
            );
          }
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

  function toggleBulkRoomType(categoryId: string) {
    setBulkRoomTypes((prev) => (prev.includes(categoryId) ? prev.filter((id) => id !== categoryId) : [...prev, categoryId]));
  }

  async function submitBulkUpdate() {
    if (bulkRoomTypes.length === 0 || !bulkValue) {
      setBulkError('Pick at least one room type and a value');
      return;
    }
    setBulkSaving(true);
    setBulkError(null);
    setBulkResult(null);
    try {
      const request = await mutate<{ status: 'pending' | 'approved' | 'rejected' }>(
        'rates.createRateChangeRequest',
        {
          hotelId,
          roomCategoryIds: bulkRoomTypes,
          startDate: bulkStart,
          endDate: bulkEnd,
          modificationRule: bulkRule,
          value: Number(bulkValue),
          discountPercent: bulkDiscount === '' ? undefined : Number(bulkDiscount),
          remarks: bulkRemarks.trim() || undefined,
        },
        token ?? undefined,
      );
      setBulkResult(request.status === 'approved' ? 'Applied immediately.' : 'Sent for owner approval.');
      if (request.status === 'approved') setCellsRefreshKey((k) => k + 1);
      setTimeout(() => {
        setBulkOpen(false);
        setBulkResult(null);
        setBulkRoomTypes([]);
        setBulkValue('');
        setBulkDiscount('');
        setBulkRemarks('');
      }, 1200);
    } catch (err) {
      setBulkError(err instanceof ApiError ? err.message : 'Failed to submit bulk update');
    } finally {
      setBulkSaving(false);
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
        subtitle="Category-wise rates and room availability, a full month at a time — updates go out to every connected channel at once."
        action={
          <div className="flex gap-2">
            <Button variant="secondary" className="text-xs" onClick={() => setBulkOpen(true)}>
              ☁️ Bulk Update
            </Button>
            {onNavigate && (
              <Button variant="secondary" className="text-xs" onClick={() => onNavigate('cm_approval_requests')}>
                ✅ Approval Requests
              </Button>
            )}
          </div>
        }
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
            onClick={() => setMonthStart((w) => addMonthsISO(w, -1))}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
            aria-label="Previous month"
          >
            ←
          </button>
          <div className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-900">{rangeLabel(days)}</div>
          <button
            type="button"
            onClick={() => setMonthStart((w) => addMonthsISO(w, 1))}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
            aria-label="Next month"
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
                <div className="flex gap-4 overflow-x-auto p-5">
                  <div className="w-44 shrink-0 rounded-xl border border-dashed border-amber-200 bg-amber-50/50 p-4">
                    <p className="flex items-center gap-1.5 text-sm font-bold text-slate-900">📦 {cat.name}</p>
                    <p className="mt-2 text-xs text-slate-500">
                      Base: <span className="font-semibold text-slate-700">₹{baseCell?.rate || '—'}</span>
                    </p>
                  </div>

                  {loadingCells
                    ? Array.from({ length: 7 }, (_, i) => <div key={i} className="h-56 w-52 shrink-0 animate-pulse rounded-xl bg-slate-100" />)
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

      {/* §user request — "Rate Update/Inventory Update alag-alag screens confusing hain, isse
          simple karo": those two pages are gone now, folded into this one (Room Management's
          main tool). Walk-in/Manual Room Block moved down from the old Inventory Update page
          unchanged — it's still the one place for "fewer rooms without a real booking/guest". */}
      <div className="mt-8">
        <WalkInRoomBlock hotelId={hotelId} />
      </div>

      {bulkOpen && (
        <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/40" onClick={() => !bulkSaving && setBulkOpen(false)}>
          <div className="h-full w-full max-w-sm overflow-y-auto bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between border-b border-slate-100 px-6 py-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Bulk Update</p>
                <p className="mt-1 text-lg font-bold text-slate-900">Apply Bulk Rate Update</p>
              </div>
              <button onClick={() => !bulkSaving && setBulkOpen(false)} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>

            <div className="space-y-5 px-6 py-5">
              <div>
                <p className="mb-2 text-xs font-medium text-slate-600">Select Room Types</p>
                <div className="space-y-2 rounded-lg border border-slate-200 p-2">
                  {categories.map((c) => (
                    <label key={c.id} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                        checked={bulkRoomTypes.includes(c.id)}
                        onChange={() => toggleBulkRoomType(c.id)}
                      />
                      <span className="text-slate-700">{c.name}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="From">
                  <input className={inputClass} type="date" value={bulkStart} onChange={(e) => setBulkStart(e.target.value)} />
                </Field>
                <Field label="To">
                  <input className={inputClass} type="date" min={bulkStart} value={bulkEnd} onChange={(e) => setBulkEnd(e.target.value)} />
                </Field>
              </div>

              <Field label="Modification Rule">
                <select className={inputClass} value={bulkRule} onChange={(e) => setBulkRule(e.target.value as 'set' | 'increase' | 'decrease')}>
                  <option value="set">Set Value (replace the rate)</option>
                  <option value="increase">Add Value (increase every date's own rate)</option>
                  <option value="decrease">Subtract Value (decrease every date's own rate)</option>
                </select>
              </Field>

              <Field label={bulkRule === 'set' ? 'Rate (₹)' : 'Value (₹)'}>
                <input className={inputClass} type="number" min={0} autoFocus value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} />
              </Field>

              <Field label="Discount (%) — optional, applied on top">
                <input className={inputClass} type="number" min={0} max={100} value={bulkDiscount} onChange={(e) => setBulkDiscount(e.target.value)} />
              </Field>

              <Field label="Remarks (optional)">
                <textarea
                  className={`${inputClass} min-h-20`}
                  value={bulkRemarks}
                  onChange={(e) => setBulkRemarks(e.target.value)}
                  placeholder="Add any notes about this bulk update…"
                />
              </Field>

              <p className="text-[11px] leading-relaxed text-slate-400">
                An owner's request applies immediately. A manager's request is sent to Approval Requests for an owner to approve first.
              </p>

              {bulkError && <p className="text-sm text-red-600">{bulkError}</p>}
              {bulkResult && <p className="text-sm text-emerald-600">{bulkResult}</p>}
            </div>

            <div className="flex items-center justify-between border-t border-slate-100 px-6 py-4">
              <button type="button" onClick={() => setBulkOpen(false)} disabled={bulkSaving} className="text-sm font-medium text-slate-500 hover:underline">
                Cancel
              </button>
              <Button type="button" onClick={() => void submitBulkUpdate()} disabled={bulkSaving || bulkRoomTypes.length === 0 || !bulkValue}>
                {bulkSaving ? 'Applying…' : 'Apply Bulk Update'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function todayPlus(days: number) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

interface RoomBlockRow {
  id: string;
  roomCategoryId: string;
  roomCategory: { name: string };
  startDate: string;
  endDate: string;
  roomsBlocked: number;
  reason: string | null;
}

/**
 * Walk-in inventory holdback (§ user request) — a walk-in guest taken straight at the front
 * desk gets no booking record or guest details here, just a quantity pulled out of the shared
 * availability pool so other channels can't oversell the same physical rooms. Deliberately
 * separate from PMS's own walk-in check-in flow, which does create a real guest/booking record.
 */
function WalkInRoomBlock({ hotelId }: { hotelId: string }) {
  const { token } = useAuth();
  const [categories, setCategories] = useState<RoomCategory[]>([]);
  const [blocks, setBlocks] = useState<RoomBlockRow[]>([]);
  const [roomCategoryId, setRoomCategoryId] = useState('');
  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState(todayPlus(1));
  const [roomsBlocked, setRoomsBlocked] = useState(1);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const [c, b] = await Promise.all([
      query<RoomCategory[]>('hotels.listRoomCategories', { hotelId }, token ?? undefined),
      query<RoomBlockRow[]>('rates.listRoomBlocks', { hotelId }, token ?? undefined),
    ]);
    setCategories(c);
    setBlocks(b);
    if (!roomCategoryId && c[0]) setRoomCategoryId(c[0].id);
  }
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await mutate(
        'rates.createRoomBlock',
        { hotelId, roomCategoryId, startDate, endDate, roomsBlocked, reason: reason.trim() || undefined },
        token ?? undefined,
      );
      setReason('');
      setRoomsBlocked(1);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to block rooms');
    } finally {
      setBusy(false);
    }
  }

  async function release(blockId: string) {
    await mutate('rates.releaseRoomBlock', { roomBlockId: blockId }, token ?? undefined);
    await refresh();
  }

  if (categories.length === 0) return null;

  return (
    <Card>
      <CardHeader
        title="Walk-in / Manual Room Block"
        subtitle="A walk-in guest taken at the desk — no booking or guest details here, just fewer rooms shown as available to every channel."
      />
      <CardBody>
        <form onSubmit={submit} className="grid grid-cols-2 gap-4 sm:grid-cols-5 sm:items-end">
          <Field label="Room category">
            <select className={inputClass} value={roomCategoryId} onChange={(e) => setRoomCategoryId(e.target.value)}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
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
          <Field label="Rooms to block">
            <input
              className={inputClass}
              type="number"
              min={1}
              value={roomsBlocked}
              onChange={(e) => setRoomsBlocked(Number(e.target.value))}
            />
          </Field>
          <Button type="submit" disabled={busy}>
            {busy ? 'Blocking…' : 'Block rooms'}
          </Button>
          <div className="col-span-2 sm:col-span-5">
            <Field label="Reason (optional)">
              <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Walk-in guest" />
            </Field>
          </div>
        </form>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

        {blocks.length > 0 && (
          <div className="mt-5 divide-y divide-slate-100 border-t border-slate-100">
            {blocks.map((b) => (
              <div key={b.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="text-sm">
                  <span className="font-medium text-slate-900">{b.roomCategory.name}</span>
                  <span className="text-slate-500">
                    {' '}
                    · {b.roomsBlocked} room{b.roomsBlocked === 1 ? '' : 's'} · {b.startDate.slice(0, 10)} → {b.endDate.slice(0, 10)}
                  </span>
                  {b.reason && <span className="text-slate-400"> · {b.reason}</span>}
                </div>
                <button onClick={() => void release(b.id)} className="shrink-0 text-xs font-medium text-brand-600 hover:underline">
                  Release
                </button>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
