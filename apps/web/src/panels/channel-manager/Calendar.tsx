import { useEffect, useMemo, useState } from 'react';
import { mutate, query, ApiError } from '../../api';
import { useAuth } from '../../AuthContext';
import { Button, Card, PageHeader, StatCard, inputClass } from '../../components/ui';
import { BookingViewModal } from '../BookingViewModal';
import { CheckInModal } from '../checkin/CheckInModal';
import { CreateReservationModal } from '../checkin/CreateReservationModal';
import { DateFilterPill, MultiDatePicker, dateRangeKeys, istDateKey, istDateLabel, addDaysKey } from '../../components/DateRangePicker';
import { OTA_LABEL, CHANNEL_META } from './ota-labels';
import { ChannelIcon } from './ChannelBadge';
import type { Booking, InventoryRate, OtaConnection, RatePlan, Restriction, Room, RoomMaintenanceBlock } from '../../types';
import type { Tab } from '../../layout/Sidebar';

type ViewMode = 'both' | 'rates' | 'stays';

// §bugfix — plain `new Date().toISOString()` slices the UTC calendar day, which is still
// "yesterday" until 5:30am IST (same reasoning as DateRangePicker's istDateKey). Route through
// IST first so "today" on this calendar always matches the actual date in India.
function todayPlus(days: number) {
  return addDaysKey(istDateKey(new Date().toISOString()), days);
}
function isSameDay(a: string, b: string) {
  return a.slice(0, 10) === b.slice(0, 10);
}

// §user request — "existing reservation ka check-in future date ki hai, usko aaj check-in kar
// diya, calendar me yahi pe aana chahiye taki pta rahe": a reservation's checkIn/checkOut dates
// stay the billing dates (nights, totalAmount, OTA restrictions never move just because the
// front desk let the guest in early) — but the calendar bar itself should still reflect where
// the room is physically occupied *from*, so an early check-in's bar starts today, not on its
// original reserved date. Late/on-time check-ins are unaffected (checkedInAt falls inside the
// already-correct checkIn..checkOut range).
function effectiveStartKey(b: Booking): string {
  const reserved = b.checkIn.slice(0, 10);
  if (b.status === 'checked_in' && b.checkedInAt) {
    const actual = istDateKey(b.checkedInAt);
    if (actual < reserved) return actual;
  }
  return reserved;
}

/**
 * §7 Phase 1 #1/#5 combined into one visual grid, rates by date underneath, every
 * reservation (any channel, or direct/walk-in) drawn as a spanning bar on its own physical
 * room's row (§user request — room-number-wise rows, category shown as a sub-label, instead
 * of one pooled row per category). Rates stay category-pooled underneath — every room in a
 * category shows the same rate cells since they're priced as one unit — only the booking
 * bars are room-specific now.
 */
export function Calendar({
  hotelId,
  onNavigate,
  hasChannelManager = true,
}: {
  hotelId: string;
  onNavigate?: (tab: Tab) => void;
  /** §user request — "CM me multiple dates select karke edit kar sakte hain, PMS me nahi": this
   * page used to be gated entirely behind the Channel Manager module, so a PMS-only org never
   * got the date-range picker or the stays grid at all. It's now open to PMS too, but the rate/
   * inventory side (channel selector, Rates view, Bulk Edit) stays hidden here — those write
   * InventoryRate rows, which are always priced per OTA connection and can't mean anything
   * without one. A PMS-only org still gets the full Stays grid and the same multi-date picker. */
  hasChannelManager?: boolean;
}) {
  const { token } = useAuth();
  const [connections, setConnections] = useState<OtaConnection[]>([]);
  const [otaConnectionId, setOtaConnectionId] = useState('');
  const [ratePlans, setRatePlans] = useState<RatePlan[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [ratesByPlan, setRatesByPlan] = useState<Record<string, InventoryRate[]>>({});
  const [restrictionsByPlan, setRestrictionsByPlan] = useState<Record<string, Restriction[]>>({});
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [viewingBooking, setViewingBooking] = useState<Booking | null>(null);
  // §user request, with a reference app's own calendar-bar click (a tooltip on hover, a
  // View/Edit/Start check-in menu on click) as the target — the bar itself no longer jumps
  // straight to the read-only detail view.
  const [menuFor, setMenuFor] = useState<{ booking: Booking; x: number; y: number } | null>(null);
  const [checkingInBooking, setCheckingInBooking] = useState<Booking | null>(null);
  const [editingGroupKey, setEditingGroupKey] = useState<string | null>(null);
  // §user request — "check-in ka option pe click karne ke baad wahi check-in wala feature khul
  // jayega, room automatic select rahega": the empty-cell menu's first option opens the real
  // CheckInModal (walk-in, same as Room View's own "Check in") with this exact room prefilled,
  // not a blank future-reservation form.
  const [checkingInRoom, setCheckingInRoom] = useState<Room | null>(null);
  // §user request, with a reference app's own empty-cell click menu as the target — click a date
  // on a specific room's own row with nothing booked there and get Check In / Add Maintenance
  // Block, instead of nothing happening at all.
  const [emptyCellMenu, setEmptyCellMenu] = useState<{ room: Room; date: string; x: number; y: number } | null>(null);
  // One panel for both Create (no existingBlock) and Edit (existingBlock set) — §user request,
  // "block daalne ke baad edit karne ka bhi option aana chahiye".
  const [maintenanceBlockPanel, setMaintenanceBlockPanel] = useState<{
    roomId: string;
    roomNumber: string;
    initialDate?: string;
    existingBlock?: RoomMaintenanceBlock;
  } | null>(null);
  // §user request — clicking an existing "Maintenance" bar gets its own Edit/Remove menu, same
  // click-then-menu pattern booking bars already have.
  const [maintenanceMenuFor, setMaintenanceMenuFor] = useState<{ block: RoomMaintenanceBlock; x: number; y: number } | null>(null);
  const [maintenanceBlocks, setMaintenanceBlocks] = useState<RoomMaintenanceBlock[]>([]);
  // §user request, with Housekeeping's own date filter as the explicit target — same From/To
  // range picker, single day or a multi-day range in one tap-through, instead of a plain
  // single-date input. The quick Today/7D/14D/... pills below still exist as shortcuts that
  // just set this same selection.
  // §user request — "15,16,17,18 dikhni chahiye jab aaj 16 ho": starting exactly at today put
  // it at the grid's left edge with nothing before it, so it never read as "today" at a glance.
  // Starting one day earlier gives it visible context on both sides.
  const [selectedDates, setSelectedDates] = useState<string[]>(() => dateRangeKeys(todayPlus(-1), todayPlus(12)));
  const [viewMode, setViewMode] = useState<ViewMode>(hasChannelManager ? 'both' : 'stays');
  const [error, setError] = useState<string | null>(null);
  // §user request — "particular cell nahi, humne jo 'Rooms on OTA' row banayi hai usi se edit
  // karenge, click karne par us date ke saare categories ka box ban jayega": editing moved from a
  // single room-category's single cell to one date at a time, every category together. Keyed by
  // roomCategoryId since one date can hold several categories' drafts at once.
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [dateEditDrafts, setDateEditDrafts] = useState<
    Record<string, { ratePlanId: string; price: string; availability: number; totalRooms: number; bookedCount: number; maxAvailable: number }>
  >({});
  const [savingDateEdit, setSavingDateEdit] = useState(false);
  const [dateEditError, setDateEditError] = useState<string | null>(null);

  // Drag-to-select (§ user request) — mouse-down on a cell then dragging across more cells in
  // the same row selects a date range; releasing on the same cell you started on is just a plain
  // click (handled by the date editor above), releasing elsewhere opens Bulk Edit.
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

  // §bugfix — "check-in ke baad OTA ka availability number change nahi ho raha": this used to
  // only re-fetch bookings + maintenance blocks, never the rate grid itself — so a check-in's
  // automatic -1 to pooled OTA availability (adjustAvailabilityForStay, backend) landed in the
  // database fine, but the "Rooms on OTA" row kept showing the number from the page's last full
  // load until it was refreshed. Every action that can move availability (check-in, maintenance
  // block create/edit/release, reservation edit) needs the rate grid re-pulled too, so this is now
  // the one function both the initial load and every "refresh after an action" call go through.
  async function loadAll() {
    try {
      const [bookingRows, maintenanceRows] = await Promise.all([
        query<Booking[]>('bookings.listReservations', { hotelId, from: startDate, to: endDate, overlapping: true }, token ?? undefined),
        query<RoomMaintenanceBlock[]>('hotels.listMaintenanceBlocks', { hotelId, from: startDate, to: endDate }, token ?? undefined),
      ]);
      setBookings(bookingRows);
      setMaintenanceBlocks(maintenanceRows);
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

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId, otaConnectionId, ratePlans.length, startDate, endDate]);

  /** Re-fetches bookings, maintenance blocks, and the rate grid — called after Edit reservation,
   * Start check-in, or a new/edited/released Maintenance Block finishes, so the numbers the action
   * can move (OTA availability included) reflect it immediately. */
  async function refreshBookings() {
    await loadAll();
  }

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

  // Derived live (not a snapshot), same reasoning as Bookings.tsx's own viewingGroup — reflects a
  // concurrent change immediately instead of showing stale data until reopened.
  const editingGroup = useMemo(
    () => (editingGroupKey ? bookings.filter((b) => (b.reservationGroupId ?? b.id) === editingGroupKey) : null),
    [editingGroupKey, bookings],
  );

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

  /**
   * Opens the date editor for every room category at once — one Rate + Availability per category,
   * prefilled from whatever's already loaded. §user request — "particular cell ki jagah, 'Rooms
   * on OTA' row pe click karke saare categories ek box mein khulen". Blocked/day-note
   * intentionally stay out of this box (still settable via Advance Update) — this is deliberately
   * the simple, common-case editor.
   *
   * §bugfix — "availability ka number 4 se upar bhi ja raha hai, lock nahi ho raha": the cap is
   * also tightened to actual physically-free rooms, not just the category's raw room count — a
   * category with 4 rooms but 1 already booked for this date can only ever have 3 truly
   * available, so that's the real ceiling (and what "out of N" now says), not 4.
   */
  function openDateEditor(date: string) {
    const drafts: Record<string, { ratePlanId: string; price: string; availability: number; totalRooms: number; bookedCount: number; maxAvailable: number }> = {};
    for (const [categoryId] of categoriesInOrder) {
      const ratePlanId = primaryPlanByCategory.get(categoryId);
      if (!ratePlanId) continue;
      const rateRows = ratesByPlan[ratePlanId] ?? [];
      const rate = rateRows.find((r) => r.date.slice(0, 10) === date);
      const totalRooms = rooms.filter((r) => r.roomCategoryId === categoryId).length;
      const bookedCount = activeBookings.filter(
        (b) => b.roomCategoryId === categoryId && effectiveStartKey(b) <= date && b.checkOut.slice(0, 10) > date,
      ).length;
      const maxAvailable = Math.max(0, totalRooms - bookedCount);
      drafts[categoryId] = {
        ratePlanId,
        price: rate ? String(rate.price) : '',
        availability: Math.min(maxAvailable, rate ? rate.availability : maxAvailable),
        totalRooms,
        bookedCount,
        maxAvailable,
      };
    }
    setDateEditDrafts(drafts);
    setDateEditError(null);
    setEditingDate(date);
  }

  function setDateEditField(categoryId: string, field: 'price' | 'availability', value: string) {
    setDateEditDrafts((prev) => {
      const current = prev[categoryId];
      if (!current) return prev;
      if (field === 'price') return { ...prev, [categoryId]: { ...current, price: value } };
      const clamped = Math.min(current.maxAvailable, Math.max(0, Number(value) || 0));
      return { ...prev, [categoryId]: { ...current, availability: clamped } };
    });
  }

  /**
   * One setValueOverride call per category that actually has a price typed in — its own
   * fan-out (rates.service.ts) pushes availability to every connected channel on its own, so
   * this never needs its own channel loop. setValueOverride never touches restrictions/notes,
   * so a deliberate stop-sell set elsewhere (Advance Update) can't be silently undone by saving
   * this simpler box.
   */
  async function saveDateEditor() {
    if (!editingDate) return;
    if (connections.length === 0) {
      setDateEditError('Connect at least one OTA channel first (Connected Channels).');
      return;
    }
    setSavingDateEdit(true);
    setDateEditError(null);
    try {
      const entries = Object.entries(dateEditDrafts).filter(([, d]) => d.price !== '');
      for (const [, draft] of entries) {
        await mutate(
          'rates.setValueOverride',
          {
            ratePlanId: draft.ratePlanId,
            otaConnectionId: connections[0].id,
            date: editingDate,
            tiers: [{ occupancyTier: 1, price: Number(draft.price), availability: draft.availability }],
          },
          token ?? undefined,
        );
      }
      await Promise.all(entries.map(([, draft]) => refreshRatePlanRates(draft.ratePlanId)));
      setEditingDate(null);
    } catch (err) {
      setDateEditError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setSavingDateEdit(false);
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
          // Plain click, no drag — open the date editor (every category at once) for this date.
          openDateEditor(dates[lo]);
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

  // §user request — "particular cell nahi, jo hamare cells hai usme bas price and availability
  // dikhegi": individual room cells are plain display now, not clickable — editing moved up to
  // the category's own "Rooms on OTA" row. Still computes per-room Blocked (see
  // unbookedRoomsByDate's own comment) since that distinction is genuinely useful to see at a
  // glance, it just no longer opens anything on click.
  function RateCells({
    ratePlanId,
    room,
    unbookedRoomsByDate,
    coveredDates,
  }: {
    ratePlanId: string | undefined;
    room: Room | null;
    unbookedRoomsByDate: Map<string, Room[]>;
    coveredDates: Set<string>;
  }) {
    const rateRows = ratePlanId ? ratesByPlan[ratePlanId] ?? [] : [];
    const rateByDate = new Map(rateRows.map((r) => [r.date.slice(0, 10), r]));
    const restrictionRows = ratePlanId ? restrictionsByPlan[ratePlanId] ?? [] : [];
    const restrictionByDate = new Map(restrictionRows.map((r) => [r.date.slice(0, 10), r]));
    return (
      <>
        {dates.map((d, i) => {
          // §user request — "booking ho jaye toh uska particular room, usme se rates hat jaane
          // chahiye": this room is actually booked/blocked on this date (the bar below already
          // says so) — no rate/availability text to show alongside it.
          if (coveredDates.has(d)) {
            return (
              <div
                key={d}
                className={`relative border-l border-slate-100 ${d === today ? 'bg-brand-50/70' : ''}`}
                style={{ gridColumn: i + 1, gridRow: 1 }}
              />
            );
          }
          const rate = rateByDate.get(d);
          const restriction = restrictionByDate.get(d);
          const unbooked = unbookedRoomsByDate.get(d) ?? [];
          const roomRank = room ? unbooked.findIndex((r) => r.id === room.id) : -1;
          const roomArtificiallyBlocked = Boolean(room) && roomRank >= 0 && !!rate && roomRank < unbooked.length - rate.availability;
          const blocked = restriction?.channelBlocked || roomArtificiallyBlocked;
          const isToday = d === today;
          return (
            <div
              key={d}
              // §bugfix — "room 102 pe click karne se Check In option nahi aa raha": this div is
              // purely display (see this component's own comment above — clicks don't do anything
              // here any more), but once a rate/availability is set for a date it stretches to
              // fill the whole grid cell and, being painted after the empty-cell click layer below,
              // silently ate clicks meant for that layer's "Check In" button — only cells still
              // showing "—" (nothing to paint) let the click fall through by accident.
              // pointer-events-none makes every cell behave like the "—" ones, regardless of what's
              // displayed in it.
              className={`relative flex flex-col justify-center border-l border-slate-100 px-1.5 py-1.5 pointer-events-none ${isToday ? 'bg-brand-50/70' : ''}`}
              style={{ gridColumn: i + 1, gridRow: 1 }}
            >
              {rate ? (
                blocked ? (
                  <p className="truncate text-[10px] font-medium text-red-500">Blocked</p>
                ) : (
                  <>
                    <p className="truncate text-[10px] font-medium text-slate-500">₹{rate.price}</p>
                    <p
                      className={`truncate text-xs font-semibold ${
                        rate.availability === 0 ? 'text-red-500' : rate.availability <= 2 ? 'text-amber-600' : 'text-emerald-700'
                      }`}
                    >
                      {rate.availability} left
                    </p>
                  </>
                )
              ) : restriction?.channelBlocked ? (
                // A restriction (Advance Bulk Update) can exist on its own, with no rate ever
                // set for this date — without this branch the cell fell through to the plain
                // "—" empty state and the block was invisible on the one screen owners
                // actually glance at (§ user request: a blocked date must show here automatically).
                <p className="truncate text-[10px] font-medium text-red-500">Blocked</p>
              ) : (
                <p className="truncate text-[10px] text-slate-300">—</p>
              )}
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
    const sorted = [...bookingsForRow].sort((a, b) => effectiveStartKey(a).localeCompare(effectiveStartKey(b)));
    const laneEndDates: string[] = [];
    const laneOf = new Map<string, number>();
    for (const b of sorted) {
      const start = effectiveStartKey(b);
      let lane = laneEndDates.findIndex((end) => end <= start);
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
          const effectiveStart = effectiveStartKey(b);
          const earlyCheckIn = effectiveStart !== b.checkIn.slice(0, 10);
          const startIdx = dates.indexOf(effectiveStart);
          const endIdx = dates.indexOf(b.checkOut.slice(0, 10));
          const colStart = startIdx === -1 ? 1 : startIdx + 1;
          const colEnd = (endIdx === -1 ? dates.length : endIdx) + 1;
          if (colEnd <= 1 || colStart > dates.length) return null;
          const meta = CHANNEL_META[b.source] ?? CHANNEL_META.direct;
          const lane = laneOf.get(b.id) ?? 0;
          const sourceLabel = OTA_LABEL[b.source] ?? (b.source === 'direct' ? 'Direct' : b.source === 'walk_in' ? 'Walk-in' : b.source);
          const ratePlanName = ratePlans.find((rp) => rp.id === b.ratePlanId)?.name;
          return (
            // §user request, with a reference app's own calendar-bar hover tooltip + click menu
            // (View/Edit/Start check-in) as the target — a quick summary on hover without opening
            // anything, and a click no longer jumps straight to the read-only detail view.
            <div
              key={b.id}
              className="group relative z-10"
              style={{ gridColumn: `${Math.max(1, colStart)} / ${Math.min(dates.length + 1, colEnd)}`, gridRow: lane + 2, marginBottom: 2, marginTop: lane === 0 ? 6 : 2 }}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuFor({ booking: b, x: Math.min(e.clientX, window.innerWidth - 200), y: Math.min(e.clientY, window.innerHeight - 170) });
                }}
                className={`flex w-full items-center gap-1 truncate rounded-md px-2 py-1 text-left text-xs font-medium shadow-sm hover:opacity-90 ${meta.bg} ${meta.text}`}
              >
                <ChannelIcon source={b.source} className="h-4 w-4 shrink-0" />
                {earlyCheckIn && <span className="shrink-0" aria-hidden="true">⏱</span>}
                <span className="truncate">{b.guestName}</span>
                <span className="ml-auto shrink-0 opacity-80">₹{Number(b.totalAmount).toLocaleString('en-IN')}</span>
              </button>

              <div
                className={`pointer-events-none absolute bottom-full left-0 z-30 mb-1 hidden w-56 rounded-lg bg-slate-900 p-3 text-xs text-white shadow-xl group-hover:block ${
                  menuFor?.booking.id === b.id ? '!hidden' : ''
                }`}
              >
                <p className="mb-1.5 truncate font-bold">{b.guestName}</p>
                <p className="text-slate-300">Source: {sourceLabel}</p>
                <p className="text-slate-300">Check-in: {istDateLabel(b.checkIn.slice(0, 10))}</p>
                <p className="text-slate-300">Check-out: {istDateLabel(b.checkOut.slice(0, 10))}</p>
                {earlyCheckIn && <p className="text-amber-300">⏱ Checked in early on {istDateLabel(effectiveStart)}</p>}
                <p className="text-slate-300">Rate Plan: {ratePlanName ?? '—'}</p>
                <p className="mt-1 text-slate-400">₹{Number(b.totalAmount).toLocaleString('en-IN')} · {b.nights} night{b.nights === 1 ? '' : 's'}</p>
              </div>
            </div>
          );
        })}
      </>
    );
  }

  /** A room out of service for a date range — same spanning-bar layout as BookingBars, stacked
   * in its own lane below whatever real bookings that room already has. */
  function MaintenanceBars({ blocks, laneCount }: { blocks: RoomMaintenanceBlock[]; laneCount: number }) {
    return (
      <>
        {blocks.map((m) => {
          const startIdx = dates.indexOf(m.startAt.slice(0, 10));
          const endIdx = dates.indexOf(m.endAt.slice(0, 10));
          const colStart = startIdx === -1 ? 1 : startIdx + 1;
          const colEnd = (endIdx === -1 ? dates.length : endIdx) + 1;
          if (colEnd <= 1 || colStart > dates.length) return null;
          return (
            <div
              key={m.id}
              className="group relative z-10"
              style={{
                gridColumn: `${Math.max(1, colStart)} / ${Math.min(dates.length + 1, colEnd)}`,
                gridRow: laneCount + 2,
                marginBottom: 2,
                marginTop: laneCount === 0 ? 6 : 2,
              }}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setMaintenanceMenuFor({ block: m, x: Math.min(e.clientX, window.innerWidth - 200), y: Math.min(e.clientY, window.innerHeight - 100) });
                }}
                className="flex w-full items-center gap-1 truncate rounded-md bg-slate-300 px-2 py-1 text-left text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-400"
              >
                🔧 Maintenance
              </button>
              <div className="pointer-events-none absolute bottom-full left-0 z-30 mb-1 hidden w-56 rounded-lg bg-slate-900 p-3 text-xs text-white shadow-xl group-hover:block">
                <p className="mb-1.5 font-bold">Maintenance block</p>
                <p className="text-slate-300">
                  {istDateLabel(m.startAt.slice(0, 10))} → {istDateLabel(m.endAt.slice(0, 10))}
                </p>
                {m.reason && <p className="mt-1 text-slate-400">{m.reason}</p>}
              </div>
            </div>
          );
        })}
      </>
    );
  }

  return (
    <div>
      <PageHeader
        title="Calendar"
        subtitle={
          hasChannelManager
            ? 'Rates and every reservation, any channel, on one grid — one row per room.'
            : 'Every reservation — direct, walk-in, any channel — on one grid, one row per room.'
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Arrivals today" value={arrivalsToday.length} />
        <StatCard label="Departures today" value={departuresToday.length} />
        <StatCard label="Currently in-house" value={inHouse.length} tone="brand" />
        <StatCard label="Payments due" value={dues.length} tone={dues.length > 0 ? 'amber' : 'slate'} />
      </div>

      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            {hasChannelManager && (
              <select className={`${inputClass} w-52`} value={otaConnectionId} onChange={(e) => setOtaConnectionId(e.target.value)}>
                <option value="">— rates for channel —</option>
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {OTA_LABEL[c.otaCode] ?? c.otaCode}
                  </option>
                ))}
              </select>
            )}
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
            {hasChannelManager && (
              <Button variant="secondary" onClick={() => setBulkDatePickerOpen(true)}>
                Bulk Edit
              </Button>
            )}
          </div>
          {hasChannelManager && (
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
          )}
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
          channel first") — so this is now just a dismissible notice, not a block. PMS-only orgs
          (hasChannelManager false) never see this at all — there's no channel for them to connect. */}
      {hasChannelManager && connections.length === 0 && ratePlans.length > 0 && (
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
              // §user request — "4 rooms mein se inventory 2 kar di toh 101,102 block dikhne
              // chahiye, 103,104 open": the rate grid used to show the exact same category-wide
              // "N left" text on every room's row, with no per-room distinction at all — there was
              // nothing here translating "2 of 4 sellable" into which 2 specific rooms that means.
              // Computed fresh per date (not stored) so it's always consistent with the live
              // availability count and real bookings, with no separate block records to keep in
              // sync or release: for each date, rooms with no overlapping booking are ranked by
              // room number, and whichever fall at or past the availability count are the ones
              // genuinely oversold — RateCells below renders those as "Blocked".
              const unbookedRoomsByDate = new Map<string, Room[]>();
              for (const d of dates) {
                const bookedRoomIds = new Set(
                  categoryBookings
                    .filter((b) => effectiveStartKey(b) <= d && b.checkOut.slice(0, 10) > d)
                    .map((b) => b.assignedRoomId)
                    .filter((id): id is string => Boolean(id)),
                );
                unbookedRoomsByDate.set(
                  d,
                  categoryRooms.filter((r) => !bookedRoomIds.has(r.id)).sort((a, b) => a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true })),
                );
              }
              // A booking only shows on its own room's row once it has one (§user request — room-
              // number-wise rows instead of one pooled category row). A reservation created before
              // check-in time ever assigned a specific room (an OTA sync, or createManualBooking)
              // has nowhere room-specific to go yet, so it falls to this category's own "Unassigned"
              // row rather than disappearing from the grid.
              const unassignedBookings = categoryBookings.filter((b) => !b.assignedRoomId || !categoryRoomIds.has(b.assignedRoomId));
              const unassignedLanes = assignLanes(unassignedBookings);
              // No rooms set up for this category yet — still show one row so its rates aren't invisible.
              const rowRooms: (Room | null)[] = categoryRooms.length > 0 ? categoryRooms : [null];
              const categoryRateRows = ratePlanId ? ratesByPlan[ratePlanId] ?? [] : [];
              return (
                <div key={categoryId}>
                  {/* §user request — "date ke niche ek row bana ke No. of Rooms on OTA dena
                      chahiye, kaafi clear rahega": one row, one number per date, for this
                      category as a whole — the thing every room row below used to repeat.
                      §user request — "particular cell nahi, hum sirf issi row mein click
                      karenge": this row is now the one clickable/draggable entry point for
                      editing — click a date to open every category's editor for it, drag
                      across dates for Bulk Edit, same gestures the individual room cells used
                      to have before they became plain display. */}
                  {viewMode !== 'stays' && ratePlanId && (
                    <div className="flex border-b border-slate-200 bg-slate-50">
                      <div className="sticky left-0 z-20 flex w-24 shrink-0 items-center bg-slate-50 px-3 py-2 sm:w-44">
                        <p className="truncate text-[10px] font-bold uppercase tracking-wide text-slate-500">Rooms on OTA</p>
                      </div>
                      <div className="grid flex-1" style={{ gridTemplateColumns: `repeat(${dates.length}, minmax(56px, 1fr))` }}>
                        {dates.map((d, i) => {
                          const rate = categoryRateRows.find((r) => r.date.slice(0, 10) === d);
                          const inDragSelection =
                            dragSelection?.instanceKey === categoryId &&
                            i >= Math.min(dragSelection.startIdx, dragSelection.endIdx) &&
                            i <= Math.max(dragSelection.startIdx, dragSelection.endIdx);
                          return (
                            <button
                              key={d}
                              type="button"
                              onMouseDown={() => startDrag(categoryId, ratePlanId, categoryId, i)}
                              onMouseEnter={() => extendDrag(categoryId, i)}
                              title="Click to edit this date, or drag across several days to bulk-edit them"
                              className={`flex items-center justify-center border-l border-slate-100 py-2 hover:bg-brand-50/60 ${inDragSelection ? 'bg-brand-100' : ''}`}
                            >
                              {rate ? (
                                <span
                                  className={`text-xs font-bold ${
                                    rate.availability === 0 ? 'text-red-500' : rate.availability <= 2 ? 'text-amber-600' : 'text-emerald-600'
                                  }`}
                                >
                                  {rate.availability}
                                </span>
                              ) : (
                                <span className="text-xs text-slate-400 hover:text-brand-600">+ Set</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {rowRooms.map((room) => {
                    const rowBookings = room ? categoryBookings.filter((b) => b.assignedRoomId === room.id) : categoryBookings;
                    const rowMaintenanceBlocks = room ? maintenanceBlocks.filter((m) => m.roomId === room.id) : [];
                    // §user request — "booking ho jaye toh uska particular room, usme se rates hat
                    // jaane chahiye": this room's own rate/availability text used to keep showing
                    // right alongside the guest-name bar on a date it's actually booked or
                    // maintenance-blocked — shared once so both the rate cells below and the
                    // empty-cell click layer agree on what counts as "covered" for this room.
                    const coveredDates = new Set(
                      dates.filter(
                        (d) =>
                          rowBookings.some((b) => effectiveStartKey(b) <= d && b.checkOut.slice(0, 10) > d) ||
                          rowMaintenanceBlocks.some((m) => m.startAt.slice(0, 10) <= d && m.endAt.slice(0, 10) > d),
                      ),
                    );
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
                          {/* §user request, matching a reference app's empty-cell click menu —
                              click a date on this specific room's row with nothing booked/blocked
                              there and get Create Reservation / Add Maintenance Block. Sits behind
                              the bars below (lower in the DOM, no explicit z-index), so it's only
                              reachable where there's nothing covering that date already. */}
                          {room && viewMode !== 'rates' && (
                            <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${dates.length}, minmax(56px, 1fr))` }}>
                              {dates.map((d, i) => {
                                if (coveredDates.has(d)) return <div key={d} />;
                                return (
                                  <button
                                    key={d}
                                    type="button"
                                    onClick={(e) =>
                                      setEmptyCellMenu({ room, date: d, x: Math.min(e.clientX, window.innerWidth - 200), y: Math.min(e.clientY, window.innerHeight - 120) })
                                    }
                                    className="h-full w-full hover:bg-brand-50/50"
                                    style={{ gridColumn: i + 1 }}
                                  />
                                );
                              })}
                            </div>
                          )}
                          {viewMode !== 'stays' && (
                            <RateCells ratePlanId={ratePlanId} room={room} unbookedRoomsByDate={unbookedRoomsByDate} coveredDates={coveredDates} />
                          )}
                          {viewMode !== 'rates' && <BookingBars rowBookings={rowBookings} laneOf={laneOf} />}
                          {viewMode !== 'rates' && rowMaintenanceBlocks.length > 0 && <MaintenanceBars blocks={rowMaintenanceBlocks} laneCount={laneCount} />}
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

      {editingDate && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => !savingDateEdit && setEditingDate(null)}>
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between border-b border-slate-100 px-6 py-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Edit rates</p>
                <p className="mt-1 text-lg font-bold text-slate-900">
                  {new Date(editingDate + 'T00:00:00Z').toLocaleDateString('en-IN', {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                    timeZone: 'UTC',
                  })}
                </p>
              </div>
              <button onClick={() => !savingDateEdit && setEditingDate(null)} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>

            {/* §user request — "Rooms on OTA row pe click karne ke baad us date ka box banega,
                jisme har category apni Rate/Availability/Will push to ke saath": one section per
                room category, all for this one date, instead of one category at a time. */}
            <div className="divide-y divide-slate-100">
              {categoriesInOrder.map(([categoryId, categoryName]) => {
                const draft = dateEditDrafts[categoryId];
                if (!draft) return null;
                return (
                  <div key={categoryId} className="space-y-3 px-6 py-5">
                    <p className="text-sm font-bold text-slate-900">{categoryName}</p>
                    <div>
                      <p className="mb-1.5 text-xs font-medium text-slate-600">Rate per night</p>
                      <input
                        className={`${inputClass} w-full`}
                        type="number"
                        min={0}
                        placeholder="—"
                        value={draft.price}
                        onChange={(e) => setDateEditField(categoryId, 'price', e.target.value)}
                      />
                    </div>
                    <div>
                      {/* §bugfix — "out of 4" used to always show the category's raw room count,
                          even when some of those rooms already had a real booking on this date —
                          the true, honest ceiling is only the rooms still physically free. */}
                      <p className="mb-1.5 text-xs font-medium text-slate-600">
                        Rooms available (out of {draft.maxAvailable}{draft.bookedCount > 0 ? `, ${draft.totalRooms} total` : ''})
                      </p>
                      {draft.bookedCount > 0 && (
                        <p className="mb-1.5 text-[11px] text-amber-600">
                          {draft.bookedCount} room{draft.bookedCount === 1 ? '' : 's'} already booked for this date — can't be counted as available.
                        </p>
                      )}
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => setDateEditField(categoryId, 'availability', String(draft.availability - 1))}
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-300 text-lg text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                          disabled={draft.availability <= 0}
                        >
                          −
                        </button>
                        <input
                          className={`${inputClass} w-20 text-center`}
                          type="number"
                          min={0}
                          max={draft.maxAvailable}
                          value={draft.availability}
                          onChange={(e) => setDateEditField(categoryId, 'availability', e.target.value)}
                        />
                        <button
                          type="button"
                          onClick={() => setDateEditField(categoryId, 'availability', String(draft.availability + 1))}
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-300 text-lg text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                          disabled={draft.availability >= draft.maxAvailable}
                        >
                          +
                        </button>
                      </div>
                    </div>
                    {connections.length > 0 && (
                      <p className="text-[11px] leading-relaxed text-slate-400">
                        Also will push to:{' '}
                        {connections.map((c, i) => (
                          <span key={c.id} className="font-medium text-slate-500">
                            {OTA_LABEL[c.otaCode] ?? c.otaCode}
                            {i < connections.length - 1 ? ', ' : ''}
                          </span>
                        ))}{' '}
                        and every other connected channel.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {dateEditError && <p className="px-6 pb-2 text-sm text-red-600">{dateEditError}</p>}

            <div className="flex items-center justify-between border-t border-slate-100 px-6 py-4">
              <button type="button" onClick={() => setEditingDate(null)} className="text-sm font-medium text-slate-500 hover:underline" disabled={savingDateEdit}>
                Cancel
              </button>
              <Button type="button" onClick={() => void saveDateEditor()} disabled={savingDateEdit}>
                {savingDateEdit ? 'Saving…' : 'Save & push'}
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

      {/* §user request, with a reference app's own calendar-bar click menu as the target — View
          reservation / Edit reservation / Start check-in, instead of the bar always jumping
          straight to the read-only detail view. */}
      {menuFor && (
        <div className="fixed inset-0 z-40" onClick={() => setMenuFor(null)}>
          <div
            className="absolute w-48 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
            style={{ left: menuFor.x, top: menuFor.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => {
                setViewingBooking(menuFor.booking);
                setMenuFor(null);
              }}
              className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
            >
              View reservation
            </button>
            {menuFor.booking.status === 'confirmed' && (
              <button
                type="button"
                onClick={() => {
                  setEditingGroupKey(menuFor.booking.reservationGroupId ?? menuFor.booking.id);
                  setMenuFor(null);
                }}
                className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
              >
                Edit reservation
              </button>
            )}
            {menuFor.booking.status === 'confirmed' && (
              <button
                type="button"
                onClick={() => {
                  setCheckingInBooking(menuFor.booking);
                  setMenuFor(null);
                }}
                className="block w-full px-3 py-2 text-left text-sm font-medium text-brand-600 hover:bg-brand-50"
              >
                Start check-in
              </button>
            )}
          </div>
        </div>
      )}

      {/* §user request, matching a reference app's own empty-cell click menu. */}
      {emptyCellMenu && (
        <div className="fixed inset-0 z-40" onClick={() => setEmptyCellMenu(null)}>
          <div
            className="absolute w-52 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
            style={{ left: emptyCellMenu.x, top: emptyCellMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="truncate border-b border-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-400">
              Room {emptyCellMenu.room.roomNumber} · {istDateLabel(emptyCellMenu.date)}
            </p>
            <button
              type="button"
              onClick={() => {
                setCheckingInRoom(emptyCellMenu.room);
                setEmptyCellMenu(null);
              }}
              className="block w-full px-3 py-2 text-left text-sm font-medium text-brand-600 hover:bg-brand-50"
            >
              Check In
            </button>
            <button
              type="button"
              onClick={() => {
                setMaintenanceBlockPanel({ roomId: emptyCellMenu.room.id, roomNumber: emptyCellMenu.room.roomNumber, initialDate: emptyCellMenu.date });
                setEmptyCellMenu(null);
              }}
              className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
            >
              Add Maintenance Block
            </button>
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

      {editingGroup && editingGroup.length > 0 && (
        <CreateReservationModal
          hotelId={hotelId}
          editGroup={editingGroup}
          onClose={() => setEditingGroupKey(null)}
          onDone={() => {
            setEditingGroupKey(null);
            void refreshBookings();
          }}
        />
      )}

      {checkingInRoom && (
        <CheckInModal
          hotelId={hotelId}
          room={checkingInRoom}
          onClose={() => setCheckingInRoom(null)}
          onDone={() => {
            setCheckingInRoom(null);
            void refreshBookings();
          }}
        />
      )}

      {maintenanceBlockPanel && (
        <MaintenanceBlockPanel
          hotelId={hotelId}
          roomId={maintenanceBlockPanel.roomId}
          roomNumber={maintenanceBlockPanel.roomNumber}
          initialDate={maintenanceBlockPanel.initialDate}
          existingBlock={maintenanceBlockPanel.existingBlock}
          token={token}
          onClose={() => setMaintenanceBlockPanel(null)}
          onSaved={() => {
            setMaintenanceBlockPanel(null);
            void refreshBookings();
          }}
        />
      )}

      {/* §user request — clicking a "Maintenance" bar gets Edit/Remove, same pattern as the
          booking-bar menu above. */}
      {maintenanceMenuFor && (
        <div className="fixed inset-0 z-40" onClick={() => setMaintenanceMenuFor(null)}>
          <div
            className="absolute w-52 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
            style={{ left: maintenanceMenuFor.x, top: maintenanceMenuFor.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => {
                const b = maintenanceMenuFor.block;
                setMaintenanceBlockPanel({ roomId: b.roomId, roomNumber: b.room.roomNumber, existingBlock: b });
                setMaintenanceMenuFor(null);
              }}
              className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
            >
              Edit Maintenance Block
            </button>
            <button
              type="button"
              onClick={async () => {
                const blockId = maintenanceMenuFor.block.id;
                setMaintenanceMenuFor(null);
                await mutate('hotels.releaseMaintenanceBlock', { maintenanceBlockId: blockId }, token ?? undefined);
                void refreshBookings();
              }}
              className="block w-full px-3 py-2 text-left text-sm font-medium text-red-600 hover:bg-red-50"
            >
              Remove Block
            </button>
          </div>
        </div>
      )}

      {checkingInBooking && (
        <CheckInModal
          hotelId={hotelId}
          reservation={checkingInBooking}
          assignedRoomNumber={rooms.find((r) => r.id === checkingInBooking.assignedRoomId)?.roomNumber}
          onClose={() => setCheckingInBooking(null)}
          onDone={() => {
            setCheckingInBooking(null);
            void refreshBookings();
          }}
        />
      )}
    </div>
  );
}

/** A UTC ISO timestamp, formatted as the local-time string a `datetime-local` input expects —
 * the inverse of `new Date(aDatetimeLocalString).toISOString()`, which is how every submit here
 * already sends a picked value back (so the round trip through Edit lands on the same instant). */
function toLocalDatetimeInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * §user request, matching a reference app's own "Create Maintenance Block" panel — opened from
 * the empty-cell menu (create) or an existing "Maintenance" bar's own menu (edit, via
 * `existingBlock`). Checks live availability (hotels.checkRoomAvailability) as the picked dates
 * change, same conflict logic the create/update mutations themselves re-check server-side.
 */
function MaintenanceBlockPanel({
  hotelId,
  roomId,
  roomNumber,
  initialDate,
  existingBlock,
  token,
  onClose,
  onSaved,
}: {
  hotelId: string;
  roomId: string;
  roomNumber: string;
  initialDate?: string;
  existingBlock?: RoomMaintenanceBlock;
  token: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = Boolean(existingBlock);
  const [startAt, setStartAt] = useState(
    existingBlock ? toLocalDatetimeInput(existingBlock.startAt) : `${initialDate}T12:00`,
  );
  const [endAt, setEndAt] = useState(
    existingBlock ? toLocalDatetimeInput(existingBlock.endAt) : `${addDaysKey(initialDate ?? '', 1)}T11:00`,
  );
  const [reason, setReason] = useState(existingBlock?.reason ?? '');
  const [availability, setAvailability] = useState<{ available: boolean; reason: string | null } | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      if (!startAt || !endAt) return;
      setChecking(true);
      try {
        const result = await query<{ available: boolean; reason: string | null }>(
          'hotels.checkRoomAvailability',
          {
            roomId,
            startAt: new Date(startAt).toISOString(),
            endAt: new Date(endAt).toISOString(),
            excludeMaintenanceBlockId: existingBlock?.id,
          },
          token ?? undefined,
        );
        if (!cancelled) setAvailability(result);
      } catch {
        if (!cancelled) setAvailability(null);
      } finally {
        if (!cancelled) setChecking(false);
      }
    }
    void check();
    return () => {
      cancelled = true;
    };
  }, [roomId, startAt, endAt, token, existingBlock?.id]);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      if (isEdit && existingBlock) {
        await mutate(
          'hotels.updateMaintenanceBlock',
          {
            maintenanceBlockId: existingBlock.id,
            startAt: new Date(startAt).toISOString(),
            endAt: new Date(endAt).toISOString(),
            reason: reason.trim() || undefined,
          },
          token ?? undefined,
        );
      } else {
        await mutate(
          'hotels.createMaintenanceBlock',
          {
            hotelId,
            roomId,
            startAt: new Date(startAt).toISOString(),
            endAt: new Date(endAt).toISOString(),
            reason: reason.trim() || undefined,
          },
          token ?? undefined,
        );
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save maintenance block');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/40" onClick={() => !saving && onClose()}>
      <div className="h-full w-full max-w-sm overflow-y-auto bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-slate-100 px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Room {roomNumber}</p>
            <p className="mt-1 text-lg font-bold text-slate-900">{isEdit ? 'Edit Maintenance Block' : 'Create Maintenance Block'}</p>
          </div>
          <button onClick={() => !saving && onClose()} className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>

        <div className="space-y-5 px-6 py-5">
          <div>
            <p className="mb-1.5 text-xs font-medium text-slate-600">Start Date & Time</p>
            <input className={`${inputClass} w-full`} type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-slate-600">End Date & Time</p>
            <input className={`${inputClass} w-full`} type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
          </div>

          {checking ? (
            <p className="text-xs text-slate-400">Checking…</p>
          ) : availability ? (
            <p className={`rounded-md px-3 py-2 text-sm font-medium ${availability.available ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
              {availability.available ? 'Room is available for these dates.' : availability.reason}
            </p>
          ) : null}

          <div>
            <p className="mb-1.5 text-xs font-medium text-slate-600">Reason (optional)</p>
            <input
              className={`${inputClass} w-full`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Plumbing repair, deep cleaning"
            />
          </div>
        </div>

        {error && <p className="px-6 pb-2 text-sm text-red-600">{error}</p>}

        <div className="flex items-center justify-between border-t border-slate-100 px-6 py-4">
          <button type="button" onClick={() => !saving && onClose()} className="text-sm font-medium text-slate-500 hover:underline" disabled={saving}>
            Cancel
          </button>
          <Button type="button" onClick={() => void submit()} disabled={saving || checking || (availability ? !availability.available : false)}>
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Block'}
          </Button>
        </div>
      </div>
    </div>
  );
}
