import { useEffect, useState } from 'react';
import { mutate, query, ApiError } from '../../api';
import { useAuth } from '../../AuthContext';
import { Button, Card, PageHeader, StatCard, inputClass } from '../../components/ui';
import { BookingViewModal } from '../BookingViewModal';
import { DateFilterPill, MultiDatePicker, dateRangeKeys } from '../../components/DateRangePicker';
import { OTA_LABEL, CHANNEL_META } from './ota-labels';
import { ChannelIcon } from './ChannelBadge';
import type { Booking, InventoryRate, OtaConnection, RatePlan, Restriction, Room } from '../../types';
import type { Tab } from '../../layout/Sidebar';

type ViewMode = 'both' | 'rates' | 'stays';

function todayPlus(days: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function isSameDay(a: string, b: string) {
  return a.slice(0, 10) === b.slice(0, 10);
}

/**
 * §7 Phase 1 #1/#5 combined into one visual grid, rates by date underneath, every
 * reservation (any channel, or direct/walk-in) drawn as a spanning bar on its own physical
 * room's row (§user request — room-number-wise rows, category shown as a sub-label, instead
 * of one pooled row per category). Rates stay category-pooled underneath — every room in a
 * category shows the same rate cells since they're priced as one unit — only the booking
 * bars are room-specific now.
 */
export function Calendar({ hotelId, onNavigate }: { hotelId: string; onNavigate?: (tab: Tab) => void }) {
  const { token } = useAuth();
  const [connections, setConnections] = useState<OtaConnection[]>([]);
  const [otaConnectionId, setOtaConnectionId] = useState('');
  const [ratePlans, setRatePlans] = useState<RatePlan[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [ratesByPlan, setRatesByPlan] = useState<Record<string, InventoryRate[]>>({});
  const [restrictionsByPlan, setRestrictionsByPlan] = useState<Record<string, Restriction[]>>({});
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [viewingBooking, setViewingBooking] = useState<Booking | null>(null);
  // §user request, with Housekeeping's own date filter as the explicit target — same From/To
  // range picker, single day or a multi-day range in one tap-through, instead of a plain
  // single-date input. The quick Today/7D/14D/... pills below still exist as shortcuts that
  // just set this same selection.
  // §user request — "15,16,17,18 dikhni chahiye jab aaj 16 ho": starting exactly at today put
  // it at the grid's left edge with nothing before it, so it never read as "today" at a glance.
  // Starting one day earlier gives it visible context on both sides.
  const [selectedDates, setSelectedDates] = useState<string[]>(() => dateRangeKeys(todayPlus(-1), todayPlus(12)));
  const [viewMode, setViewMode] = useState<ViewMode>('both');
  const [error, setError] = useState<string | null>(null);
  // instanceKey scopes the modal to the exact row clicked (the rate plan id — one row per category).
  const [editingCell, setEditingCell] = useState<{ instanceKey: string; ratePlanId: string; roomCategoryId: string; date: string } | null>(null);
  const [draftPrice, setDraftPrice] = useState('');
  const [draftAvailability, setDraftAvailability] = useState(1);
  const [draftBlocked, setDraftBlocked] = useState(false);
  const [draftNote, setDraftNote] = useState('');
  const [loadingCell, setLoadingCell] = useState(false);
  const [savingCell, setSavingCell] = useState(false);
  // otaConnectionId -> whether THAT channel individually has a stop-sell restriction for this
  // cell's date (§ user request) — a channel can be blocked on its own via Advance Bulk Update,
  // and "Will push to" needs to show that plainly before Save & push here can silently flatten it.
  const [channelBlockStatus, setChannelBlockStatus] = useState<Record<string, boolean>>({});

  // Drag-to-select (§ user request) — mouse-down on a cell then dragging across more cells in
  // the same row selects a date range; releasing on the same cell you started on is just a plain
  // click (handled by the existing single-cell editor above), releasing elsewhere opens Bulk Edit.
  const [dragSelection, setDragSelection] = useState<{
    instanceKey: string;
    ratePlanId: string;
    roomCategoryId: string;
    startIdx: number;
    endIdx: number;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [bulkEdit, setBulkEdit] = useState<{
    rowLabel: string;
    roomCategoryId: string;
    startDate: string;
    endDate: string;
  } | null>(null);
  const [bulkDaysFilter, setBulkDaysFilter] = useState<'all' | 'weekdays' | 'weekends'>('all');
  const [bulkApplyTo, setBulkApplyTo] = useState<string[]>([]);
  const [bulkPrice, setBulkPrice] = useState('');
  const [bulkAvailability, setBulkAvailability] = useState(1);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkResult, setBulkResult] = useState<string | null>(null);
  // §user request — "multiple date select nahi kar pa raha hoon block/rate change ke liye":
  // the grid's drag-to-select gesture needs a real mouse (mousedown/mouseenter/mouseup never
  // fire from a touch swipe, and a touch swipe across the row is already the horizontal-scroll
  // gesture), so it silently did nothing on phone/tablet. This button opens the same tap-through
  // From/To picker used everywhere else to pick the range instead, then opens the identical Bulk
  // Edit panel the drag gesture already opens — same destination, a gesture that actually works
  // on a touchscreen to get there.
  const [bulkDatePickerOpen, setBulkDatePickerOpen] = useState(false);

  const dates = selectedDates;
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
          setRestrictionsByPlan({});
          return;
        }
        const entries = await Promise.all(
          ratePlans.map(async (rp) => {
            const grid = await query<{ rates: InventoryRate[]; restrictions: Restriction[] }>(
              'rates.getGrid',
              { ratePlanId: rp.id, otaConnectionId, startDate, endDate },
              token ?? undefined,
            );
            return [rp.id, grid.rates.filter((r) => r.occupancyTier === 1), grid.restrictions] as const;
          }),
        );
        setRatesByPlan(Object.fromEntries(entries.map(([id, rates]) => [id, rates])));
        setRestrictionsByPlan(Object.fromEntries(entries.map(([id, , restrictions]) => [id, restrictions])));
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

  const today = todayPlus(0);
  const arrivalsToday = activeBookings.filter((b) => isSameDay(b.checkIn, today));
  const departuresToday = activeBookings.filter((b) => isSameDay(b.checkOut, today) && b.status === 'checked_in');
  const inHouse = activeBookings.filter((b) => b.status === 'checked_in');
  const dues = activeBookings.filter((b) => Number(b.paidAmount ?? 0) < Number(b.totalAmount));

  const categoriesInOrder = [...new Map(ratePlans.map((rp) => [rp.roomCategoryId, rp.roomCategoryName])).entries()];

  async function refreshRatePlanRates(ratePlanId: string) {
    if (!otaConnectionId) return;
    const grid = await query<{ rates: InventoryRate[]; restrictions: Restriction[] }>(
      'rates.getGrid',
      { ratePlanId, otaConnectionId, startDate, endDate },
      token ?? undefined,
    );
    setRatesByPlan((prev) => ({ ...prev, [ratePlanId]: grid.rates.filter((r) => r.occupancyTier === 1) }));
    setRestrictionsByPlan((prev) => ({ ...prev, [ratePlanId]: grid.restrictions }));
  }

  /** Opens the Edit Cell modal and loads this cell's current blocked-state + private day note (not part of the already-fetched grid data). */
  async function openCellEditor(
    instanceKey: string,
    ratePlanId: string,
    roomCategoryId: string,
    date: string,
    rate: InventoryRate | undefined,
    restriction: Restriction | undefined,
  ) {
    setEditingCell({ instanceKey, ratePlanId, roomCategoryId, date });
    setDraftPrice(rate ? String(rate.price) : '');
    setDraftAvailability(rate ? rate.availability : 1);
    setDraftBlocked(restriction?.channelBlocked ?? false);
    setDraftNote('');
    setChannelBlockStatus({});
    setLoadingCell(true);
    try {
      const [note, blockStatus] = await Promise.all([
        query<{ note: string } | null>('rates.getDayNote', { roomCategoryId, date }, token ?? undefined),
        query<Record<string, boolean>>('rates.getChannelBlockStatus', { ratePlanId, date }, token ?? undefined),
      ]);
      setDraftNote(note?.note ?? '');
      setChannelBlockStatus(blockStatus);
    } finally {
      setLoadingCell(false);
    }
  }

  /**
   * Pooled inventory means one Save here pushes to every connected channel at once, not
   * just whichever channel happened to be selected in the grid's filter dropdown — the
   * server loops every OTA connection (`RatesService.saveCellEditor`).
   */
  async function saveCellEditor() {
    if (!editingCell || !draftPrice) return;
    setSavingCell(true);
    try {
      await mutate(
        'rates.saveCellEditor',
        {
          hotelId,
          roomCategoryId: editingCell.roomCategoryId,
          ratePlanId: editingCell.ratePlanId,
          date: editingCell.date,
          price: Number(draftPrice),
          availability: draftAvailability,
          blocked: draftBlocked,
          dayNote: draftNote,
        },
        token ?? undefined,
      );
      await refreshRatePlanRates(editingCell.ratePlanId);
      setEditingCell(null);
    } finally {
      setSavingCell(false);
    }
  }

  function startDrag(instanceKey: string, ratePlanId: string, roomCategoryId: string, idx: number) {
    setIsDragging(true);
    setDragSelection({ instanceKey, ratePlanId, roomCategoryId, startIdx: idx, endIdx: idx });
  }

  function extendDrag(instanceKey: string, idx: number) {
    if (!isDragging) return;
    setDragSelection((prev) => (prev && prev.instanceKey === instanceKey ? { ...prev, endIdx: idx } : prev));
  }

  // A single global mouseup finalizes the drag regardless of which element the cursor is
  // over when the button is released (dragging past the grid's edge, over a label, etc.).
  useEffect(() => {
    function onMouseUp() {
      setIsDragging(false);
      setDragSelection((sel) => {
        if (!sel) return null;
        const lo = Math.min(sel.startIdx, sel.endIdx);
        const hi = Math.max(sel.startIdx, sel.endIdx);
        if (lo === hi) {
          // Plain click, no drag — open the single-cell editor exactly as before.
          const d = dates[lo];
          const rateRows = ratesByPlan[sel.ratePlanId] ?? [];
          const rate = rateRows.find((r) => r.date.slice(0, 10) === d);
          const restrictionRows = restrictionsByPlan[sel.ratePlanId] ?? [];
          const restriction = restrictionRows.find((r) => r.date.slice(0, 10) === d);
          void openCellEditor(sel.instanceKey, sel.ratePlanId, sel.roomCategoryId, d, rate, restriction);
          return null;
        }
        setBulkEdit({
          rowLabel: categoriesInOrder.find(([id]) => id === sel.roomCategoryId)?.[1] ?? '',
          roomCategoryId: sel.roomCategoryId,
          startDate: dates[lo],
          endDate: dates[hi],
        });
        setBulkDaysFilter('all');
        setBulkApplyTo([sel.roomCategoryId]);
        setBulkPrice('');
        setBulkAvailability(1);
        setBulkError(null);
        setBulkResult(null);
        return null;
      });
    }
    window.addEventListener('mouseup', onMouseUp);
    return () => window.removeEventListener('mouseup', onMouseUp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dates, ratesByPlan, restrictionsByPlan, categoriesInOrder]);

  async function saveBulkEdit() {
    if (!bulkEdit || !bulkPrice || bulkApplyTo.length === 0) return;
    setBulkSaving(true);
    setBulkError(null);
    try {
      const daysOfWeek = bulkDaysFilter === 'weekdays' ? [1, 2, 3, 4, 5] : bulkDaysFilter === 'weekends' ? [0, 6] : undefined;
      await mutate(
        'rates.bulkEditCells',
        {
          hotelId,
          roomCategoryIds: bulkApplyTo,
          startDate: bulkEdit.startDate,
          endDate: bulkEdit.endDate,
          daysOfWeek,
          price: Number(bulkPrice),
          availability: bulkAvailability,
        },
        token ?? undefined,
      );
      await Promise.all(ratePlans.filter((rp) => bulkApplyTo.includes(rp.roomCategoryId)).map((rp) => refreshRatePlanRates(rp.id)));
      setBulkResult(`Updated ${bulkApplyTo.length} categor${bulkApplyTo.length === 1 ? 'y' : 'ies'}.`);
      setTimeout(() => setBulkEdit(null), 700);
    } catch (err) {
      setBulkError(err instanceof ApiError ? err.message : 'Bulk edit failed');
    } finally {
      setBulkSaving(false);
    }
  }

  function RateCells({ instanceKey, ratePlanId, roomCategoryId }: { instanceKey: string; ratePlanId: string | undefined; roomCategoryId: string }) {
    const rateRows = ratePlanId ? ratesByPlan[ratePlanId] ?? [] : [];
    const rateByDate = new Map(rateRows.map((r) => [r.date.slice(0, 10), r]));
    const restrictionRows = ratePlanId ? restrictionsByPlan[ratePlanId] ?? [] : [];
    const restrictionByDate = new Map(restrictionRows.map((r) => [r.date.slice(0, 10), r]));
    return (
      <>
        {dates.map((d, i) => {
          const rate = rateByDate.get(d);
          const restriction = restrictionByDate.get(d);
          const inDragSelection =
            dragSelection?.instanceKey === instanceKey &&
            i >= Math.min(dragSelection.startIdx, dragSelection.endIdx) &&
            i <= Math.max(dragSelection.startIdx, dragSelection.endIdx);
          const isToday = d === today;
          return (
            <div
              key={d}
              className={`relative border-l border-slate-100 ${isToday ? 'bg-brand-50/70' : ''}`}
              style={{ gridColumn: i + 1, gridRow: 1 }}
            >
              <button
                type="button"
                disabled={!ratePlanId || !otaConnectionId}
                onMouseDown={() => ratePlanId && startDrag(instanceKey, ratePlanId, roomCategoryId, i)}
                onMouseEnter={() => extendDrag(instanceKey, i)}
                title={
                  otaConnectionId
                    ? "Click to edit this date, or drag across several days to bulk-edit them"
                    : 'Pick a channel first'
                }
                className={`group w-full select-none px-1.5 py-1.5 text-left hover:bg-brand-50/60 disabled:cursor-default disabled:hover:bg-transparent ${
                  inDragSelection ? 'bg-brand-100' : ''
                }`}
              >
                {rate ? (
                  <>
                    <p
                      className={`truncate text-[10px] font-medium ${
                        restriction?.channelBlocked
                          ? 'text-red-500'
                          : rate.availability === 0
                            ? 'text-red-500'
                            : rate.availability <= 2
                              ? 'text-amber-600'
                              : 'text-emerald-600'
                      }`}
                    >
                      {restriction?.channelBlocked ? 'Blocked' : `${rate.availability} left`}
                    </p>
                    <p className="truncate text-xs font-semibold text-slate-700">₹{rate.price}</p>
                  </>
                ) : restriction?.channelBlocked ? (
                  // A restriction (Advance Bulk Update) can exist on its own, with no rate ever
                  // set for this date — without this branch the cell fell through to the plain
                  // "+ Rate" empty state and the block was invisible on the one screen owners
                  // actually glance at (§ user request: a blocked date must show here automatically).
                  <p className="truncate text-[10px] font-medium text-red-500">Blocked</p>
                ) : ratePlanId && otaConnectionId ? (
                  // §bugfix — "+ Set rate" force-wrapped mid-word ("+ Set rat" / "e") in the
                  // narrower mobile column (56px, added for §user request's "4 dates on mobile"),
                  // overflowing this row's height and visually bleeding into the booking bar/row
                  // below it. Shorter text plus `truncate` (belt-and-suspenders) keeps it to one
                  // line no matter how narrow the column gets.
                  <p className="truncate text-[10px] text-slate-400 group-hover:font-medium group-hover:text-brand-600">+ Rate</p>
                ) : (
                  <p className="truncate text-[10px] text-slate-300">—</p>
                )}
              </button>
            </div>
          );
        })}
      </>
    );
  }

  /** §found while wiring up the click-to-view-details fix — multiple bookings in the same
   * category with overlapping dates (e.g. a 2-room or 10-room group booking, exactly what
   * Shivam/Neeraj Ji's bookings are) were all drawn at the same grid position, stacked directly
   * on top of each other — only the topmost was ever visible or clickable. Greedy interval
   * scheduling assigns each booking the lowest free "lane" so overlapping ones stack into
   * separate rows instead of hiding one another. */
  function assignLanes(bookingsForRow: Booking[]): { laneOf: Map<string, number>; laneCount: number } {
    const sorted = [...bookingsForRow].sort((a, b) => a.checkIn.localeCompare(b.checkIn));
    const laneEndDates: string[] = [];
    const laneOf = new Map<string, number>();
    for (const b of sorted) {
      let lane = laneEndDates.findIndex((end) => end <= b.checkIn);
      if (lane === -1) {
        lane = laneEndDates.length;
        laneEndDates.push(b.checkOut);
      } else {
        laneEndDates[lane] = b.checkOut;
      }
      laneOf.set(b.id, lane);
    }
    return { laneOf, laneCount: Math.max(1, laneEndDates.length) };
  }

  function BookingBars({ rowBookings, laneOf }: { rowBookings: Booking[]; laneOf: Map<string, number> }) {
    return (
      <>
        {rowBookings.map((b) => {
          const startIdx = dates.indexOf(b.checkIn.slice(0, 10));
          const endIdx = dates.indexOf(b.checkOut.slice(0, 10));
          const colStart = startIdx === -1 ? 1 : startIdx + 1;
          const colEnd = (endIdx === -1 ? dates.length : endIdx) + 1;
          if (colEnd <= 1 || colStart > dates.length) return null;
          const meta = CHANNEL_META[b.source] ?? CHANNEL_META.direct;
          const lane = laneOf.get(b.id) ?? 0;
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => setViewingBooking(b)}
              title={`${b.guestName} — ₹${b.totalAmount} — ${b.nights} night${b.nights === 1 ? '' : 's'} — click for details`}
              className={`relative z-10 flex items-center gap-1 truncate rounded-md px-2 py-1 text-left text-xs font-medium shadow-sm hover:opacity-90 ${meta.bg} ${meta.text}`}
              style={{ gridColumn: `${Math.max(1, colStart)} / ${Math.min(dates.length + 1, colEnd)}`, gridRow: lane + 2, marginBottom: 2, marginTop: lane === 0 ? 6 : 2 }}
            >
              <ChannelIcon source={b.source} className="h-4 w-4 shrink-0" />
              <span className="truncate">{b.guestName}</span>
              <span className="ml-auto shrink-0 opacity-80">₹{Number(b.totalAmount).toLocaleString('en-IN')}</span>
            </button>
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
            <DateFilterPill selected={selectedDates} onChange={setSelectedDates} />
            <div className="flex rounded-lg bg-slate-100 p-1">
              {([
                ['Today', 1],
                ['7D', 7],
                ['14D', 14],
                ['30D', 30],
                ['60D', 60],
              ] as [string, number][]).map(([label, days]) => (
                <button
                  key={label}
                  onClick={() => setSelectedDates(dateRangeKeys(todayPlus(0), todayPlus(days - 1)))}
                  className="rounded-md px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-white hover:text-slate-900"
                >
                  {label}
                </button>
              ))}
            </div>
            <Button variant="secondary" onClick={() => setBulkDatePickerOpen(true)}>
              Bulk Edit
            </Button>
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

      {/* §user request — "yeh concept alag hai, channel manager + direct + walk-in booking bhi
          show hongi": stays (every booking, any source) used to be hidden behind this exact same
          "no channel connected" wall as the rate grid, even though a direct/walk-in reservation
          has nothing to do with OTA connections. Only the rate grid actually needs a channel —
          RateCells already degrades gracefully with none connected (disabled cells, "Pick a
          channel first") — so this is now just a dismissible notice, not a block. */}
      {connections.length === 0 && ratePlans.length > 0 && (
        <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-900/20">
          <p className="text-sm text-amber-800 dark:text-amber-300">
            No channel connected yet — rates stay hidden until you connect one. Stays from every source (Direct, Walk-in, every OTA) still show below.
          </p>
          {onNavigate && (
            <Button variant="secondary" className="shrink-0" onClick={() => onNavigate('cm_channels')}>
              Go to Connected Channels
            </Button>
          )}
        </Card>
      )}

      {ratePlans.length === 0 ? (
        <Card className="p-6 text-center text-sm text-slate-400">No rate plans yet — create one on Linked Rate Plan first.</Card>
      ) : (
        // §user request — "date k side se move kre toh dates move ho, room side se flexible ho":
        // touch-action: pan-x keeps a horizontal swipe here unambiguously a date-scroll (the
        // sticky room column visually stays put per-row, as already verified), while leaving
        // vertical page scroll — "room side" scrolling down to see more rooms — untouched and
        // free, since this only constrains this element's own horizontal axis.
        <Card className="overflow-x-auto p-0" style={{ touchAction: 'pan-x', WebkitOverflowScrolling: 'touch' }}>
          <div style={{ minWidth: dates.length * 56 + 96 }}>
            <div className="flex border-b border-slate-200 bg-slate-50">
              {/* §user request — "rooms static kro slide na kare": sticky so the room/category
                  label column stays put while the date columns scroll horizontally underneath it.
                  Narrower on mobile (w-24 vs w-44) so a small phone screen still fits at least 4
                  date columns alongside it without forcing a scroll just to see "today". */}
              <div className="sticky left-0 z-20 w-24 shrink-0 bg-slate-50 px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500 sm:w-44">Room</div>
              <div className="grid flex-1" style={{ gridTemplateColumns: `repeat(${dates.length}, minmax(56px, 1fr))` }}>
                {dates.map((d) => {
                  const dt = new Date(d + 'T00:00:00Z');
                  const isToday = d === today;
                  return (
                    <div key={d} className={`border-l border-slate-100 px-1.5 py-2 text-center ${isToday ? 'bg-brand-100' : ''}`}>
                      <p className={`text-[10px] font-medium uppercase ${isToday ? 'text-brand-600' : 'text-slate-400'}`}>
                        {dt.toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' })}
                      </p>
                      {isToday ? (
                        <span className="mx-auto mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">
                          {dt.getUTCDate()}
                        </span>
                      ) : (
                        <p className="text-xs font-semibold text-slate-700">{dt.getUTCDate()}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {categoriesInOrder.map(([categoryId, categoryName]) => {
              const ratePlanId = primaryPlanByCategory.get(categoryId);
              const categoryRooms = rooms.filter((r) => r.roomCategoryId === categoryId);
              const categoryRoomIds = new Set(categoryRooms.map((r) => r.id));
              const categoryBookings = activeBookings.filter((b) => b.roomCategoryId === categoryId);
              // A booking only shows on its own room's row once it has one (§user request — room-
              // number-wise rows instead of one pooled category row). A reservation created before
              // check-in time ever assigned a specific room (an OTA sync, or createManualBooking)
              // has nowhere room-specific to go yet, so it falls to this category's own "Unassigned"
              // row rather than disappearing from the grid.
              const unassignedBookings = categoryBookings.filter((b) => !b.assignedRoomId || !categoryRoomIds.has(b.assignedRoomId));
              const unassignedLanes = assignLanes(unassignedBookings);
              // No rooms set up for this category yet — still show one row so its rates aren't invisible.
              const rowRooms: (Room | null)[] = categoryRooms.length > 0 ? categoryRooms : [null];
              return (
                <div key={categoryId}>
                  {rowRooms.map((room) => {
                    const rowBookings = room ? categoryBookings.filter((b) => b.assignedRoomId === room.id) : categoryBookings;
                    const { laneOf, laneCount } = assignLanes(rowBookings);
                    const barsHeight = laneCount * 30;
                    const instanceKey = room ? room.id : categoryId;
                    return (
                      <div key={instanceKey} className="flex border-b border-slate-100 hover:bg-slate-50/60">
                        {/* §bugfix — "Neeraj ki booking room no ke upar ja rahi hai": a multi-night
                            booking bar that started before the visible window (clipped to the grid's
                            first column) and this sticky label both used z-10; at a tie, later DOM
                            order wins, so the bar (rendered after the label) painted over it once
                            scrolling brought that bar's column under the label's screen position.
                            z-20 here (matching the header row) always outranks the bar's z-10. */}
                        <div className="sticky left-0 z-20 flex w-24 shrink-0 items-start gap-2 bg-white px-3 py-3 sm:w-44">
                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-bold text-slate-900">{room ? room.roomNumber : categoryName}</p>
                            <p className="truncate text-xs text-slate-400">{categoryName}</p>
                          </div>
                        </div>
                        <div
                          className="relative grid flex-1"
                          style={{ gridTemplateColumns: `repeat(${dates.length}, minmax(56px, 1fr))`, minHeight: viewMode === 'rates' ? 64 : Math.max(64, 40 + barsHeight) }}
                        >
                          {viewMode !== 'stays' && <RateCells instanceKey={instanceKey} ratePlanId={ratePlanId} roomCategoryId={categoryId} />}
                          {viewMode !== 'rates' && <BookingBars rowBookings={rowBookings} laneOf={laneOf} />}
                        </div>
                      </div>
                    );
                  })}
                  {categoryRooms.length > 0 && unassignedBookings.length > 0 && (
                    <div className="flex border-b border-slate-100 bg-slate-50/40 hover:bg-slate-50/60">
                      <div className="sticky left-0 z-20 flex w-24 shrink-0 items-start gap-2 bg-white px-3 py-3 sm:w-44">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold italic text-slate-500">Unassigned</p>
                          <p className="truncate text-xs text-slate-400">{categoryName}</p>
                        </div>
                      </div>
                      <div
                        className="relative grid flex-1"
                        style={{ gridTemplateColumns: `repeat(${dates.length}, minmax(56px, 1fr))`, minHeight: Math.max(64, 40 + unassignedLanes.laneCount * 30) }}
                      >
                        {viewMode !== 'rates' && <BookingBars rowBookings={unassignedBookings} laneOf={unassignedLanes.laneOf} />}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {editingCell && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setEditingCell(null)}>
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between border-b border-slate-100 px-6 py-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Edit cell</p>
                <p className="mt-1 text-lg font-bold text-slate-900">
                  {new Date(editingCell.date + 'T00:00:00Z').toLocaleDateString('en-IN', {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                    timeZone: 'UTC',
                  })}
                </p>
              </div>
              <button onClick={() => setEditingCell(null)} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>

            <div className="space-y-5 px-6 py-5">
              <div>
                <p className="mb-1.5 text-xs font-medium text-slate-600">Day note</p>
                <textarea
                  className={`${inputClass} w-full`}
                  rows={2}
                  placeholder="Private note for staff — guests never see this."
                  value={draftNote}
                  onChange={(e) => setDraftNote(e.target.value)}
                  disabled={loadingCell}
                />
              </div>

              <div className="flex rounded-lg bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => setDraftBlocked(false)}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-2 text-sm font-semibold ${!draftBlocked ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
                >
                  🔓 Open
                </button>
                <button
                  type="button"
                  onClick={() => setDraftBlocked(true)}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-2 text-sm font-semibold ${draftBlocked ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
                >
                  🔒 Blocked
                </button>
              </div>

              <div>
                <p className="mb-1.5 text-xs font-medium text-slate-600">Rate per night</p>
                <input
                  autoFocus
                  className={`${inputClass} w-full`}
                  type="number"
                  min={0}
                  value={draftPrice}
                  onChange={(e) => setDraftPrice(e.target.value)}
                />
              </div>

              <div>
                <p className="mb-1.5 text-xs font-medium text-slate-600">Rooms available</p>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setDraftAvailability((v) => Math.max(0, v - 1))}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-300 text-lg text-slate-600 hover:bg-slate-50"
                  >
                    −
                  </button>
                  <input
                    className={`${inputClass} w-20 text-center`}
                    type="number"
                    min={0}
                    value={draftAvailability}
                    onChange={(e) => setDraftAvailability(Math.max(0, Number(e.target.value)))}
                  />
                  <button
                    type="button"
                    onClick={() => setDraftAvailability((v) => v + 1)}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-300 text-lg text-slate-600 hover:bg-slate-50"
                  >
                    +
                  </button>
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Will push to</p>
                {connections.length === 0 ? (
                  <p className="text-xs text-slate-400">No channels connected yet — this will only save locally.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {connections.map((c) => {
                      const isIndividuallyBlocked = channelBlockStatus[c.id] ?? false;
                      return (
                        <span
                          key={c.id}
                          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
                            isIndividuallyBlocked ? 'border-red-200 bg-red-50 text-red-700' : 'border-slate-200 text-slate-700'
                          }`}
                        >
                          <ChannelIcon source={c.otaCode} className="h-4 w-4" />
                          {OTA_LABEL[c.otaCode] ?? c.otaCode}
                          {isIndividuallyBlocked && <span className="font-semibold">· Blocked</span>}
                        </span>
                      );
                    })}
                  </div>
                )}
                <p className="mt-2.5 text-[11px] leading-relaxed text-slate-400">
                  Price and rooms available push to every connected channel together — same pooled inventory a real booking draws from.
                  Incoming OTA bookings can still take a little longer to show up here; that timing is controlled by the OTA, not this
                  screen.
                </p>
                {connections.some((c) => (channelBlockStatus[c.id] ?? false) !== draftBlocked) && (
                  <p className="mt-2.5 rounded-md bg-amber-50 px-2.5 py-2 text-[11px] font-medium text-amber-700">
                    ⚠️ The Open/Blocked toggle above also pushes to every channel — saving will set{' '}
                    {connections
                      .filter((c) => (channelBlockStatus[c.id] ?? false) !== draftBlocked)
                      .map((c) => OTA_LABEL[c.otaCode] ?? c.otaCode)
                      .join(', ')}{' '}
                    to <strong>{draftBlocked ? 'Blocked' : 'Open'}</strong> too, overriding what Advance Bulk Update set for{' '}
                    {connections.filter((c) => (channelBlockStatus[c.id] ?? false) !== draftBlocked).length === 1 ? 'it' : 'them'}{' '}
                    individually.
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-slate-100 px-6 py-4">
              <button type="button" onClick={() => setEditingCell(null)} className="text-sm font-medium text-slate-500 hover:underline">
                Cancel
              </button>
              <Button type="button" onClick={() => void saveCellEditor()} disabled={savingCell || loadingCell || !draftPrice}>
                {savingCell ? 'Saving…' : 'Save & push'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {bulkDatePickerOpen && (
        <MultiDatePicker
          selected={selectedDates}
          onClose={() => setBulkDatePickerOpen(false)}
          onApply={(pickedDates) => {
            setBulkDatePickerOpen(false);
            setBulkEdit({ rowLabel: '', roomCategoryId: '', startDate: pickedDates[0], endDate: pickedDates[pickedDates.length - 1] });
            setBulkDaysFilter('all');
            setBulkApplyTo([]);
            setBulkPrice('');
            setBulkAvailability(1);
            setBulkError(null);
            setBulkResult(null);
          }}
        />
      )}

      {bulkEdit && (
        <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/40" onClick={() => !bulkSaving && setBulkEdit(null)}>
          <div className="h-full w-full max-w-sm overflow-y-auto bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between border-b border-slate-100 px-6 py-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Bulk edit</p>
                <p className="mt-1 text-lg font-bold text-slate-900">
                  {new Date(bulkEdit.startDate + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })} –{' '}
                  {new Date(bulkEdit.endDate + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}
                </p>
                {bulkEdit.rowLabel && <p className="mt-0.5 text-sm text-slate-500">{bulkEdit.rowLabel}</p>}
              </div>
              <button onClick={() => !bulkSaving && setBulkEdit(null)} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>

            <div className="space-y-5 px-6 py-5">
              <div>
                <p className="mb-1.5 text-xs font-medium text-slate-600">Days in range</p>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      ['all', 'All days'],
                      ['weekdays', 'Weekdays'],
                      ['weekends', 'Weekends'],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setBulkDaysFilter(value)}
                      className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                        bulkDaysFilter === value ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-1.5 text-xs font-medium text-slate-600">Rate per night</p>
                <input autoFocus className={`${inputClass} w-full`} type="number" min={0} value={bulkPrice} onChange={(e) => setBulkPrice(e.target.value)} />
              </div>

              <div>
                <p className="mb-1.5 text-xs font-medium text-slate-600">Rooms available</p>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setBulkAvailability((v) => Math.max(0, v - 1))}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-300 text-lg text-slate-600 hover:bg-slate-50"
                  >
                    −
                  </button>
                  <input
                    className={`${inputClass} w-20 text-center`}
                    type="number"
                    min={0}
                    value={bulkAvailability}
                    onChange={(e) => setBulkAvailability(Math.max(0, Number(e.target.value)))}
                  />
                  <button
                    type="button"
                    onClick={() => setBulkAvailability((v) => v + 1)}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-300 text-lg text-slate-600 hover:bg-slate-50"
                  >
                    +
                  </button>
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-medium text-slate-600">Apply to</p>
                <div className="space-y-2 rounded-lg border border-slate-200 p-2">
                  {categoriesInOrder.map(([categoryId, categoryName]) => (
                    <label key={categoryId} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                        checked={bulkApplyTo.includes(categoryId)}
                        onChange={(e) =>
                          setBulkApplyTo((prev) => (e.target.checked ? [...prev, categoryId] : prev.filter((id) => id !== categoryId)))
                        }
                      />
                      <span className={categoryId === bulkEdit.roomCategoryId ? 'font-medium text-slate-900' : 'text-slate-700'}>
                        {categoryName}
                        {categoryId === bulkEdit.roomCategoryId && <span className="ml-1 text-xs text-slate-400">(this row)</span>}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <p className="text-[11px] leading-relaxed text-slate-400">
                Changes save to every selected category and sync to all connected channels immediately.
              </p>

              {bulkError && <p className="text-sm text-red-600">{bulkError}</p>}
              {bulkResult && <p className="text-sm text-emerald-600">{bulkResult}</p>}
            </div>

            <div className="flex items-center justify-between border-t border-slate-100 px-6 py-4">
              <button type="button" onClick={() => setBulkEdit(null)} disabled={bulkSaving} className="text-sm font-medium text-slate-500 hover:underline">
                Cancel
              </button>
              <Button type="button" onClick={() => void saveBulkEdit()} disabled={bulkSaving || !bulkPrice || bulkApplyTo.length === 0}>
                {bulkSaving ? 'Applying…' : 'Apply'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* §user request — "koi bhi booking pr click karu toh uski detail khul jani chahiye" —
          same read-only billing view the Reservations table's own "View" opens. */}
      {viewingBooking && (
        <BookingViewModal
          booking={viewingBooking}
          roomType={categoriesInOrder.find(([id]) => id === viewingBooking.roomCategoryId)?.[1] ?? '—'}
          onClose={() => setViewingBooking(null)}
        />
      )}
    </div>
  );
}
