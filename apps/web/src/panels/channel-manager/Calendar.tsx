import { useEffect, useMemo, useState } from 'react';
import { mutate, query, ApiError } from '../../api';
import { useAuth } from '../../AuthContext';
import { Card, PageHeader, StatCard, inputClass } from '../../components/ui';
import { OTA_LABEL, CHANNEL_META } from './ota-labels';
import { ChannelIcon } from './ChannelBadge';
import type { Booking, InventoryRate, OtaConnection, RatePlan, Room } from '../../types';

type ViewRange = 'today' | '7d' | '14d' | '30d' | '60d';
type ViewMode = 'both' | 'rates' | 'stays';

const RANGE_DAYS: Record<ViewRange, number> = { today: 1, '7d': 7, '14d': 14, '30d': 30, '60d': 60 };

function todayPlus(days: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function isSameDay(a: string, b: string) {
  return a.slice(0, 10) === b.slice(0, 10);
}
function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
function dateRangeArray(start: string, days: number) {
  const out: string[] = [];
  const cursor = new Date(start + 'T00:00:00Z');
  for (let i = 0; i < days; i++) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

/**
 * Which physical room a not-yet-arrived reservation *would* occupy — for
 * display only. Our check-in flow deliberately never assigns a room before
 * the guest actually arrives (§8.4 — a direct/OTA reservation has no
 * `assigned_room_id` until check-in), so a still-confirmed booking has no
 * real room yet. Real (checked-in/completed) assignments are used as-is;
 * everything else gets a greedy first-free-room guess per category, purely
 * so the grid has somewhere to draw its bar — it commits nothing.
 */
function allocateRoomsForCategory(roomIds: string[], categoryBookings: Booking[]): Map<string, string> {
  const assignment = new Map<string, string>();
  const occupied = new Map<string, { checkIn: string; checkOut: string }[]>(roomIds.map((id) => [id, []]));
  const sorted = [...categoryBookings].sort((a, b) => a.checkIn.localeCompare(b.checkIn));

  for (const b of sorted) {
    if (b.assignedRoomId && occupied.has(b.assignedRoomId)) {
      assignment.set(b.id, b.assignedRoomId);
      occupied.get(b.assignedRoomId)!.push({ checkIn: b.checkIn, checkOut: b.checkOut });
    }
  }
  for (const b of sorted) {
    if (assignment.has(b.id)) continue;
    for (const roomId of roomIds) {
      const ranges = occupied.get(roomId)!;
      const overlaps = ranges.some((r) => b.checkIn < r.checkOut && r.checkIn < b.checkOut);
      if (!overlaps) {
        assignment.set(b.id, roomId);
        ranges.push({ checkIn: b.checkIn, checkOut: b.checkOut });
        break;
      }
    }
  }
  return assignment;
}

/**
 * §7 Phase 1 #1/#5 combined into one visual grid, per physical room — rates
 * by date underneath, every reservation (any channel, or direct/walk-in)
 * drawn as a spanning bar on its own room's row, grouped under its room
 * category. Falls back to category-level rows for a Channel-Manager-only
 * org with no physical rooms (PMS-only concept, §5.3).
 */
export function Calendar({ hotelId }: { hotelId: string }) {
  const { token } = useAuth();
  const [connections, setConnections] = useState<OtaConnection[]>([]);
  const [otaConnectionId, setOtaConnectionId] = useState('');
  const [ratePlans, setRatePlans] = useState<RatePlan[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [ratesByPlan, setRatesByPlan] = useState<Record<string, InventoryRate[]>>({});
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [range, setRange] = useState<ViewRange>('14d');
  const [viewMode, setViewMode] = useState<ViewMode>('both');
  const [anchorDate, setAnchorDate] = useState(todayPlus(0));
  const [error, setError] = useState<string | null>(null);
  // instanceKey scopes the popover to the exact row clicked (a room id, or a rate-plan id in the
  // no-PMS-rooms fallback) — several rows can share the same ratePlanId (every room in a category
  // prices off one plan), so keying on ratePlanId+date alone would pop the editor open on every row at once.
  const [editingCell, setEditingCell] = useState<{ instanceKey: string; ratePlanId: string; date: string } | null>(null);
  const [draftPrice, setDraftPrice] = useState('');
  const [draftAvailability, setDraftAvailability] = useState('');
  const [savingCell, setSavingCell] = useState(false);

  const dates = useMemo(() => dateRangeArray(anchorDate, RANGE_DAYS[range]), [anchorDate, range]);
  const startDate = dates[0];
  const endDate = dates[dates.length - 1];

  useEffect(() => {
    query<OtaConnection[]>('ota.listConnections', { hotelId }, token ?? undefined).then((conns) => {
      setConnections(conns);
      if (!otaConnectionId && conns[0]) setOtaConnectionId(conns[0].id);
    });
    query<RatePlan[]>('rates.listAllRatePlansForHotel', { hotelId }, token ?? undefined).then(setRatePlans);
    query<Room[]>('hotels.listRooms', { hotelId }, token ?? undefined).then(setRooms);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId]);

  useEffect(() => {
    async function load() {
      try {
        const bookingRows = await query<Booking[]>('bookings.listReservations', { hotelId, from: startDate, to: endDate }, token ?? undefined);
        setBookings(bookingRows);
        if (!otaConnectionId || ratePlans.length === 0) {
          setRatesByPlan({});
          return;
        }
        const entries = await Promise.all(
          ratePlans.map(async (rp) => {
            const grid = await query<{ rates: InventoryRate[] }>(
              'rates.getGrid',
              { ratePlanId: rp.id, otaConnectionId, startDate, endDate },
              token ?? undefined,
            );
            return [rp.id, grid.rates.filter((r) => r.occupancyTier === 1)] as const;
          }),
        );
        setRatesByPlan(Object.fromEntries(entries));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Failed to load calendar');
      }
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId, otaConnectionId, ratePlans.length, startDate, endDate]);

  // One primary rate plan per room category — every physical room in that category shows this rate (rooms of the same type share pricing).
  const primaryPlanByCategory = new Map<string, string>();
  for (const rp of ratePlans) if (!primaryPlanByCategory.has(rp.roomCategoryId)) primaryPlanByCategory.set(rp.roomCategoryId, rp.id);

  const activeBookings = bookings.filter((b) => b.status !== 'cancelled');

  // Greedy per-category room allocation for display, computed fresh each render off the current booking set.
  const bookingRoomId = useMemo(() => {
    const merged = new Map<string, string>();
    const roomIdsByCategory = new Map<string, string[]>();
    for (const r of rooms) {
      if (!r.roomCategoryId) continue;
      if (!roomIdsByCategory.has(r.roomCategoryId)) roomIdsByCategory.set(r.roomCategoryId, []);
      roomIdsByCategory.get(r.roomCategoryId)!.push(r.id);
    }
    for (const [categoryId, roomIds] of roomIdsByCategory) {
      const categoryBookings = activeBookings.filter((b) => b.roomCategoryId === categoryId);
      const assignment = allocateRoomsForCategory(roomIds, categoryBookings);
      for (const [bookingId, roomId] of assignment) merged.set(bookingId, roomId);
    }
    return merged;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rooms, activeBookings.map((b) => `${b.id}:${b.checkIn}:${b.checkOut}`).join(',')]);

  const today = todayPlus(0);
  const arrivalsToday = activeBookings.filter((b) => isSameDay(b.checkIn, today));
  const departuresToday = activeBookings.filter((b) => isSameDay(b.checkOut, today) && b.status === 'checked_in');
  const inHouse = activeBookings.filter((b) => b.status === 'checked_in');
  const dues = activeBookings.filter((b) => Number(b.paidAmount ?? 0) < Number(b.totalAmount));

  const usePerRoomRows = rooms.length > 0;
  // Rows: either one per physical room (grouped under a category header), or one per room category (no PMS rooms exist).
  const roomsByCategory = new Map<string, Room[]>();
  for (const r of rooms) {
    const key = r.roomCategoryId ?? '__uncategorized';
    if (!roomsByCategory.has(key)) roomsByCategory.set(key, []);
    roomsByCategory.get(key)!.push(r);
  }
  const categoriesInOrder = [...new Map(ratePlans.map((rp) => [rp.roomCategoryId, rp.roomCategoryName])).entries()];

  async function exportRow(ratePlanId: string, label: string) {
    if (!otaConnectionId) return;
    const csv = await query<string>('rates.exportGridCsv', { ratePlanId, otaConnectionId, startDate, endDate }, token ?? undefined);
    downloadCsv(`${label}-${startDate}-to-${endDate}.csv`, csv);
  }

  async function refreshRatePlanRates(ratePlanId: string) {
    if (!otaConnectionId) return;
    const grid = await query<{ rates: InventoryRate[] }>('rates.getGrid', { ratePlanId, otaConnectionId, startDate, endDate }, token ?? undefined);
    setRatesByPlan((prev) => ({ ...prev, [ratePlanId]: grid.rates.filter((r) => r.occupancyTier === 1) }));
  }

  function openCellEditor(instanceKey: string, ratePlanId: string, date: string, rate: InventoryRate | undefined) {
    if (!otaConnectionId) return;
    setEditingCell({ instanceKey, ratePlanId, date });
    setDraftPrice(rate ? String(rate.price) : '');
    setDraftAvailability(rate ? String(rate.availability) : '');
  }

  /** Click-to-edit is a Value Override (§7 Phase 1 #3) — a genuinely separate, one-cell write path, exactly matching what this popover does. */
  async function saveCellEditor() {
    if (!editingCell || !otaConnectionId || !draftPrice || draftAvailability === '') return;
    setSavingCell(true);
    try {
      await mutate(
        'rates.setValueOverride',
        {
          ratePlanId: editingCell.ratePlanId,
          otaConnectionId,
          date: editingCell.date,
          tiers: [{ occupancyTier: 1, price: Number(draftPrice), availability: Number(draftAvailability) }],
        },
        token ?? undefined,
      );
      await refreshRatePlanRates(editingCell.ratePlanId);
      setEditingCell(null);
    } finally {
      setSavingCell(false);
    }
  }

  function RateCells({ instanceKey, ratePlanId }: { instanceKey: string; ratePlanId: string | undefined }) {
    const rateRows = ratePlanId ? ratesByPlan[ratePlanId] ?? [] : [];
    const rateByDate = new Map(rateRows.map((r) => [r.date.slice(0, 10), r]));
    return (
      <>
        {dates.map((d, i) => {
          const rate = rateByDate.get(d);
          const isEditing = editingCell?.instanceKey === instanceKey && editingCell.date === d;
          return (
            <div key={d} className="relative border-l border-slate-100" style={{ gridColumn: i + 1, gridRow: 1 }}>
              <button
                type="button"
                disabled={!ratePlanId || !otaConnectionId}
                onClick={() => ratePlanId && openCellEditor(instanceKey, ratePlanId, d, rate)}
                title={otaConnectionId ? 'Click to edit this date\'s price & availability' : 'Pick a channel first'}
                className="w-full px-1.5 py-1.5 text-left hover:bg-brand-50/60 disabled:cursor-default disabled:hover:bg-transparent"
              >
                {rate ? (
                  <>
                    <p className="text-[10px] text-slate-400">{rate.availability} left</p>
                    <p className="text-xs font-semibold text-slate-700">₹{rate.price}</p>
                  </>
                ) : (
                  <p className="text-[10px] text-slate-300">—</p>
                )}
              </button>
              {isEditing && (
                <div className="absolute left-0 top-full z-30 mt-1 w-44 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
                  <p className="mb-2 text-[11px] text-slate-500">{d} · 1 room</p>
                  <label className="mb-1.5 block">
                    <span className="text-[10px] font-medium text-slate-500">Price</span>
                    <input
                      autoFocus
                      className={`${inputClass} w-full`}
                      type="number"
                      min={0}
                      value={draftPrice}
                      onChange={(e) => setDraftPrice(e.target.value)}
                    />
                  </label>
                  <label className="mb-2 block">
                    <span className="text-[10px] font-medium text-slate-500">Availability</span>
                    <input
                      className={`${inputClass} w-full`}
                      type="number"
                      min={0}
                      value={draftAvailability}
                      onChange={(e) => setDraftAvailability(e.target.value)}
                    />
                  </label>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={saveCellEditor}
                      disabled={savingCell}
                      className="flex-1 rounded-lg bg-brand-600 px-2 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                    >
                      {savingCell ? 'Saving…' : 'Save'}
                    </button>
                    <button type="button" onClick={() => setEditingCell(null)} className="rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-100">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </>
    );
  }

  function BookingBars({ rowBookings }: { rowBookings: Booking[] }) {
    return (
      <>
        {rowBookings.map((b) => {
          const startIdx = dates.indexOf(b.checkIn.slice(0, 10));
          const endIdx = dates.indexOf(b.checkOut.slice(0, 10));
          const colStart = startIdx === -1 ? 1 : startIdx + 1;
          const colEnd = (endIdx === -1 ? dates.length : endIdx) + 1;
          if (colEnd <= 1 || colStart > dates.length) return null;
          const meta = CHANNEL_META[b.source] ?? CHANNEL_META.direct;
          return (
            <div
              key={b.id}
              title={`${b.guestName} — ₹${b.totalAmount} — ${b.nights} night${b.nights === 1 ? '' : 's'}`}
              className={`z-10 flex items-center gap-1 truncate rounded-md px-2 py-1 text-xs font-medium shadow-sm ${meta.bg} ${meta.text}`}
              style={{ gridColumn: `${Math.max(1, colStart)} / ${Math.min(dates.length + 1, colEnd)}`, gridRow: 1, alignSelf: 'end', marginBottom: 4, marginTop: 20 }}
            >
              <ChannelIcon source={b.source} className="h-4 w-4" />
              <span className="truncate">{b.guestName}</span>
              <span className="ml-auto shrink-0 opacity-80">₹{Number(b.totalAmount).toLocaleString('en-IN')}</span>
            </div>
          );
        })}
      </>
    );
  }

  return (
    <div>
      <PageHeader title="Calendar" subtitle="Rates and every reservation, any channel, on one grid — one row per room." />

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Arrivals today" value={arrivalsToday.length} />
        <StatCard label="Departures today" value={departuresToday.length} />
        <StatCard label="Currently in-house" value={inHouse.length} tone="brand" />
        <StatCard label="Payments due" value={dues.length} tone={dues.length > 0 ? 'amber' : 'slate'} />
      </div>

      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <select className={`${inputClass} w-52`} value={otaConnectionId} onChange={(e) => setOtaConnectionId(e.target.value)}>
              <option value="">— rates for channel —</option>
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {OTA_LABEL[c.otaCode] ?? c.otaCode}
                </option>
              ))}
            </select>
            <input className={inputClass} type="date" value={anchorDate} onChange={(e) => setAnchorDate(e.target.value)} />
            <div className="flex rounded-lg bg-slate-100 p-1">
              {(['today', '7d', '14d', '30d', '60d'] as ViewRange[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium ${range === r ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
                >
                  {r === 'today' ? 'Today' : r.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <div className="flex rounded-lg bg-slate-100 p-1">
            {(['both', 'stays', 'rates'] as ViewMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setViewMode(m)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize ${viewMode === m ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
              >
                {m === 'both' ? 'Rates & Stays' : m}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-500">
          {Object.keys(CHANNEL_META).map((code) => (
            <span key={code} className="flex items-center gap-1.5">
              <ChannelIcon source={code} className="h-4 w-4" />
              {OTA_LABEL[code] ?? (code === 'direct' ? 'Direct' : code === 'walk_in' ? 'Walk-in' : code)}
            </span>
          ))}
        </div>
      </Card>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {ratePlans.length === 0 ? (
        <Card className="p-6 text-center text-sm text-slate-400">No rate plans yet — create one on Linked Rate Plan first.</Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <div style={{ minWidth: dates.length * 90 + 180 }}>
            <div className="flex border-b border-slate-100 bg-slate-50">
              <div className="w-44 shrink-0 px-3 py-2 text-xs font-semibold text-slate-500">{usePerRoomRows ? 'Room' : 'Room category'}</div>
              <div className="grid flex-1" style={{ gridTemplateColumns: `repeat(${dates.length}, minmax(90px, 1fr))` }}>
                {dates.map((d) => {
                  const dt = new Date(d + 'T00:00:00Z');
                  const isToday = d === today;
                  return (
                    <div key={d} className={`border-l border-slate-100 px-1.5 py-2 text-center ${isToday ? 'bg-brand-50' : ''}`}>
                      <p className="text-[10px] font-medium uppercase text-slate-400">{dt.toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' })}</p>
                      <p className={`text-xs font-semibold ${isToday ? 'text-brand-700' : 'text-slate-700'}`}>{dt.getUTCDate()}</p>
                    </div>
                  );
                })}
              </div>
            </div>

            {usePerRoomRows
              ? categoriesInOrder.map(([categoryId, categoryName]) => {
                  const categoryRooms = roomsByCategory.get(categoryId) ?? [];
                  const ratePlanId = primaryPlanByCategory.get(categoryId);
                  if (categoryRooms.length === 0) return null;
                  return (
                    <div key={categoryId}>
                      <div className="border-b border-slate-100 bg-slate-50/70 px-3 py-1.5 text-xs font-semibold text-slate-600">
                        {categoryName} <span className="font-normal text-slate-400">· {categoryRooms.length} room{categoryRooms.length === 1 ? '' : 's'}</span>
                      </div>
                      {categoryRooms.map((room) => {
                        const roomBookings = activeBookings.filter((b) => bookingRoomId.get(b.id) === room.id);
                        return (
                          <div key={room.id} className="flex border-b border-slate-50">
                            <div className="w-44 shrink-0 px-3 py-3">
                              <p className="text-sm font-medium text-slate-900">{room.roomNumber}</p>
                              {ratePlanId && (
                                <button onClick={() => void exportRow(ratePlanId, room.roomNumber)} className="text-xs text-brand-500 hover:underline">
                                  CSV
                                </button>
                              )}
                            </div>
                            <div className="relative grid flex-1" style={{ gridTemplateColumns: `repeat(${dates.length}, minmax(90px, 1fr))`, minHeight: 64 }}>
                              {viewMode !== 'stays' && <RateCells instanceKey={room.id} ratePlanId={ratePlanId} />}
                              {viewMode !== 'rates' && <BookingBars rowBookings={roomBookings} />}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })
              : ratePlans.map((rp) => {
                  const isPrimary = primaryPlanByCategory.get(rp.roomCategoryId) === rp.id;
                  const rowBookings = isPrimary ? activeBookings.filter((b) => b.roomCategoryId === rp.roomCategoryId) : [];
                  return (
                    <div key={rp.id} className="flex border-b border-slate-50">
                      <div className="w-44 shrink-0 px-3 py-3">
                        <p className="text-sm font-medium text-slate-900">{rp.roomCategoryName}</p>
                        <div className="flex items-center gap-1.5 text-xs text-slate-400">
                          <span>
                            {rp.name}
                            {rp.mealPlan ? `, ${rp.mealPlan}` : ''}
                          </span>
                          {otaConnectionId && (
                            <button onClick={() => void exportRow(rp.id, `${rp.roomCategoryName}-${rp.name}`)} className="text-brand-500 hover:underline">
                              CSV
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="relative grid flex-1" style={{ gridTemplateColumns: `repeat(${dates.length}, minmax(90px, 1fr))`, minHeight: 64 }}>
                        {viewMode !== 'stays' && <RateCells instanceKey={rp.id} ratePlanId={rp.id} />}
                        {viewMode !== 'rates' && <BookingBars rowBookings={rowBookings} />}
                      </div>
                    </div>
                  );
                })}
          </div>
        </Card>
      )}
    </div>
  );
}
