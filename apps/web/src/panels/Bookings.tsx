import { useEffect, useMemo, useState } from 'react';
import { mutate, query, ApiError } from '../api';
import { useAuth } from '../AuthContext';
import { Badge, Card, CardBody, EmptyState, Field, PageHeader, inputClass } from '../components/ui';
import { CheckInModal } from './checkin/CheckInModal';
import { CreateReservationModal } from './checkin/CreateReservationModal';
import { AddPaymentModal } from './AddPaymentModal';
import { BookingViewModal } from './BookingViewModal';
import { ReservationDetailModal } from './ReservationDetailModal';
import { computeInvoiceTotals } from '../invoice';
import { SOURCE_LABEL } from './channel-manager/ota-labels';
import { ChannelBadge } from './channel-manager/ChannelBadge';
import { formatDateShort } from '../dateFormat';
import { MoreActionsPanel } from './MoreActionsPanel';
import type { Booking, RatePlan, Room, RoomCategory } from '../types';

type ListTab = 'upcoming' | 'checked_in' | 'history';
const TAB_LABEL: Record<ListTab, string> = { upcoming: 'Upcoming', checked_in: 'Checked In', history: 'History' };
const STATUS_LABEL: Record<Booking['status'], string> = {
  confirmed: 'Upcoming',
  checked_in: 'Checked In',
  checked_out: 'Checked Out',
  cancelled: 'Cancelled',
  no_show: 'No Show',
  void: 'Voided',
};

/** "23 Nov" — the date-section header above a day's run of reservations, no year (this list
 * never spans far enough for that to matter) and deliberately shorter than formatDateShort's own
 * DD/MM/YY, since that reads badly as a standalone heading. */
function dateHeaderLabel(dateKey: string) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export function Bookings({ hotelId, hasPms = true }: { hotelId: string; hasPms?: boolean }) {
  const { token } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [categories, setCategories] = useState<RoomCategory[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [ratePlans, setRatePlans] = useState<RatePlan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [payingBooking, setPayingBooking] = useState<Booking | null>(null);
  const [checkingInBooking, setCheckingInBooking] = useState<Booking | null>(null);
  const [viewingBooking, setViewingBooking] = useState<Booking | null>(null);
  const [viewingGroupKey, setViewingGroupKey] = useState<string | null>(null);
  const [actionsGroupKey, setActionsGroupKey] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [sourceFilter, setSourceFilter] = useState('all');
  const [listTab, setListTab] = useState<ListTab>('upcoming');
  const [search, setSearch] = useState('');

  async function refresh() {
    try {
      const [b, c, r, rp] = await Promise.all([
        query<Booking[]>('bookings.listReservations', { hotelId }, token ?? undefined),
        query<RoomCategory[]>('hotels.listRoomCategories', { hotelId }, token ?? undefined),
        query<Room[]>('hotels.listRooms', { hotelId }, token ?? undefined),
        query<RatePlan[]>('rates.listAllRatePlansForHotel', { hotelId }, token ?? undefined),
      ]);
      setBookings(b);
      setCategories(c);
      setRooms(r);
      setRatePlans(rp);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load reservations');
    }
  }
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId]);

  const filtered = useMemo(() => {
    return sourceFilter === 'all' ? bookings : bookings.filter((b) => b.source === sourceFilter);
  }, [bookings, sourceFilter]);

  // §user request, with a reference app's own Reservations screen as the visual target —
  // Upcoming/Checked In/History tabs instead of one flat table of every status mixed together.
  const tabCounts = useMemo(
    () => ({
      upcoming: filtered.filter((b) => b.status === 'confirmed').length,
      checked_in: filtered.filter((b) => b.status === 'checked_in').length,
      history: filtered.filter((b) => b.status === 'checked_out' || b.status === 'cancelled' || b.status === 'no_show' || b.status === 'void').length,
    }),
    [filtered],
  );
  const tabFiltered = useMemo(
    () =>
      filtered.filter((b) =>
        listTab === 'upcoming'
          ? b.status === 'confirmed'
          : listTab === 'checked_in'
            ? b.status === 'checked_in'
            : b.status === 'checked_out' || b.status === 'cancelled' || b.status === 'no_show' || b.status === 'void',
      ),
    [filtered, listTab],
  );

  // §user request, with a reference app's own Reservations list ("5 Rooms | dates | 2N") as the
  // visual target — a multi-room reservation is several Booking rows sharing one
  // reservationGroupId; they render as a single card here. A booking with no group id (every
  // OTA/legacy/single-room booking) is just its own group of one, unchanged.
  const groupedRows = useMemo(() => {
    const rows = hasPms ? tabFiltered : filtered;
    const order: string[] = [];
    const groups = new Map<string, Booking[]>();
    for (const b of rows) {
      const key = b.reservationGroupId ?? b.id;
      if (!groups.has(key)) {
        groups.set(key, []);
        order.push(key);
      }
      groups.get(key)!.push(b);
    }
    return order.map((key) => groups.get(key)!);
  }, [hasPms, tabFiltered, filtered]);

  // §user request — DigiStay's Reservations list searches "Booking ID, Guest Name, Contact";
  // matters most once a group booking makes scrolling to find one wedding guest impractical.
  const searchedRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return groupedRows;
    return groupedRows.filter((group) =>
      group.some(
        (b) =>
          b.guestName.toLowerCase().includes(term) ||
          (b.guestPhone ?? '').includes(term) ||
          (b.bookedByName ?? '').toLowerCase().includes(term) ||
          (b.bookedByPhone ?? '').includes(term) ||
          (b.billToCompanyName ?? '').toLowerCase().includes(term) ||
          b.id.slice(-6).toLowerCase().includes(term),
      ),
    );
  }, [groupedRows, search]);

  const roomsById = useMemo(() => new Map(rooms.map((r) => [r.id, r])), [rooms]);

  // §user request — "after creating a reservation ye saari dates k according upcoming bookings
  // mein show ho" + a reference app's own date-grouped list as the target: a date header (e.g.
  // "23 Nov") above every run of same-day reservations, instead of one flat list. The API already
  // orders by checkIn ascending, so this only needs to notice when the date changes between
  // consecutive groups — no separate sort.
  const dateSections = useMemo(() => {
    const sections: { dateKey: string; groups: Booking[][] }[] = [];
    for (const group of searchedRows) {
      const dateKey = group[0].checkIn.slice(0, 10);
      const last = sections[sections.length - 1];
      if (last && last.dateKey === dateKey) last.groups.push(group);
      else sections.push({ dateKey, groups: [group] });
    }
    return sections;
  }, [searchedRows]);

  // Derived live (not a snapshot) so the open detail modal reflects a check-in/payment right
  // after it happens, instead of showing stale data until the modal is closed and reopened.
  const viewingGroup = useMemo(
    () => (viewingGroupKey ? bookings.filter((row) => (row.reservationGroupId ?? row.id) === viewingGroupKey) : null),
    [viewingGroupKey, bookings],
  );
  const actionsGroup = useMemo(
    () => (actionsGroupKey ? bookings.filter((row) => (row.reservationGroupId ?? row.id) === actionsGroupKey) : null),
    [actionsGroupKey, bookings],
  );

  async function cancelBooking(bookingId: string) {
    if (!confirm('Cancel this reservation? This cannot be undone.')) return;
    try {
      await mutate('bookings.cancelBooking', { bookingId }, token ?? undefined);
      setViewingBooking(null);
      void refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to cancel');
    }
  }

  return (
    <div className="relative">
      {/* §user request — "itna stretch na kare, thoda mid tak rahega toh better rahega, kyunki
          right side mein aisa table khulega": a reference app's own Reservations screen keeps
          the list to roughly the left half, leaving the right side clean for whatever opens
          alongside it (a detail/actions panel), instead of stretching cards edge-to-edge. */}
      <div className="max-w-2xl">
      <PageHeader
        title="Reservations"
        subtitle={hasPms ? `${bookings.length} total — every channel, plus direct/walk-in bookings` : `${bookings.length} total — every connected channel, automatically`}
      />

      {/* §user request, with a reference app's own Reservations screen as the visual target —
          Upcoming/Checked In/History tabs above a plain filter row, clean cards below instead of
          a dense table. */}
      {hasPms && (
        <div className="mb-4 flex gap-2">
          {(['upcoming', 'checked_in', 'history'] as ListTab[]).map((t) => (
            <button
              key={t}
              onClick={() => setListTab(t)}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                listTab === t
                  ? 'bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200 dark:bg-brand-500/10 dark:text-brand-300 dark:ring-brand-400/30'
                  : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
              }`}
            >
              {TAB_LABEL[t]} ({tabCounts[t]})
            </button>
          ))}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Field label="Channel">
          <select className={inputClass} value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
            <option value="all">All channels</option>
            {Object.entries(SOURCE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Search">
          <input
            className={inputClass}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Booking ID, guest name, contact"
          />
        </Field>
      </div>

      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {searchedRows.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState title="No reservations match" />
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-5">
          {dateSections.map((section) => (
            <div key={section.dateKey}>
              <p className="mb-2.5 text-sm font-bold text-slate-500 dark:text-slate-400">{dateHeaderLabel(section.dateKey)}</p>
              <div className="space-y-2.5">
                {section.groups.map((group) => (
                  <ReservationCard
                    key={group.length > 1 ? group[0].reservationGroupId! : group[0].id}
                    group={group}
                    categories={categories}
                    roomsById={roomsById}
                    onClick={() => (group.length > 1 ? setViewingGroupKey(group[0].reservationGroupId ?? group[0].id) : setViewingBooking(group[0]))}
                    onMoreActions={() => setActionsGroupKey(group[0].reservationGroupId ?? group[0].id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      </div>

      {/* §user request, with a reference app's own floating "+" as the visual target — opens the
          full multi-room Create Reservation flow (source → dates → guest details → pick specific
          rooms → per-room pricing → advance payment), right where the thumb already is on a phone. */}
      {hasPms && (
        <button
          onClick={() => setShowCreate(true)}
          aria-label="New reservation"
          className="fixed bottom-6 right-6 flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-2xl text-white shadow-lg hover:bg-brand-700"
        >
          +
        </button>
      )}

      {showCreate && (
        <CreateReservationModal
          hotelId={hotelId}
          onClose={() => setShowCreate(false)}
          onDone={() => {
            setShowCreate(false);
            void refresh();
          }}
        />
      )}

      {payingBooking && (
        <AddPaymentModal booking={payingBooking} onClose={() => setPayingBooking(null)} onDone={refresh} />
      )}
      {checkingInBooking && (
        <CheckInModal hotelId={hotelId} reservation={checkingInBooking} onClose={() => setCheckingInBooking(null)} onDone={refresh} />
      )}
      {viewingGroup && viewingGroup.length > 0 && (
        <ReservationDetailModal
          hotelId={hotelId}
          bookings={viewingGroup}
          onClose={() => setViewingGroupKey(null)}
          onChanged={() => {
            void refresh();
          }}
        />
      )}
      {actionsGroup && actionsGroup.length > 0 && (
        <MoreActionsPanel
          hotelId={hotelId}
          group={actionsGroup}
          roomsById={roomsById}
          categories={categories}
          ratePlans={ratePlans}
          onClose={() => setActionsGroupKey(null)}
          onChanged={() => {
            void refresh();
          }}
        />
      )}
      {viewingBooking && (
        <BookingViewModal
          booking={viewingBooking}
          roomType={categories.find((c) => c.id === viewingBooking.roomCategoryId)?.name ?? '—'}
          onClose={() => setViewingBooking(null)}
          onCheckIn={
            hasPms && viewingBooking.status === 'confirmed'
              ? () => {
                  setCheckingInBooking(viewingBooking);
                  setViewingBooking(null);
                }
              : undefined
          }
          onCancel={hasPms && viewingBooking.status === 'confirmed' ? () => cancelBooking(viewingBooking.id) : undefined}
          onAddPayment={
            hasPms
              ? () => {
                  setPayingBooking(viewingBooking);
                  setViewingBooking(null);
                }
              : undefined
          }
        />
      )}
    </div>
  );
}

/**
 * §user request, with a reference app's own Reservations card as the visual target — an
 * initials avatar, a Check In/Check Out row, a per-category room-count summary with a couple of
 * actual room-number chips, and a Total Amount/Due/Reserved-count footer, instead of the plain
 * one-line summary this list used to show.
 */
function ReservationCard({
  group,
  categories,
  roomsById,
  onClick,
  onMoreActions,
}: {
  group: Booking[];
  categories: RoomCategory[];
  roomsById: Map<string, Room>;
  onClick: () => void;
  onMoreActions: () => void;
}) {
  const b = group[0];
  const grandTotal = group.reduce((sum, row) => {
    const totals = computeInvoiceTotals({
      totalAmount: Number(row.totalAmount),
      lineItems: row.lineItems ?? [],
      discountAmount: row.discountAmount ? Number(row.discountAmount) : null,
      gstExempt: row.gstExempt,
    });
    return sum + totals.grandTotal;
  }, 0);
  const paid = group.reduce((sum, row) => sum + Number(row.paidAmount ?? 0), 0);
  const due = Math.max(0, grandTotal - paid);
  const statuses = new Set(group.map((row) => row.status));
  const groupLabel = statuses.size === 1 ? STATUS_LABEL[b.status] : 'Partially Checked In';
  const activeCount = group.filter((row) => row.status !== 'cancelled' && row.status !== 'no_show' && row.status !== 'void').length;

  const categoryCounts = new Map<string, number>();
  for (const row of group) {
    const name = roomsById.get(row.assignedRoomId ?? '')?.roomCategory?.name ?? categories.find((c) => c.id === row.roomCategoryId)?.name ?? '—';
    categoryCounts.set(name, (categoryCounts.get(name) ?? 0) + 1);
  }
  const roomSummary = [...categoryCounts.entries()].map(([name, count]) => `${count} ${name}`).join(' · ');
  const roomNumbers = group.map((row) => roomsById.get(row.assignedRoomId ?? '')?.roomNumber).filter((n): n is string => Boolean(n));

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onClick()}
      className="w-full cursor-pointer overflow-hidden rounded-xl border border-slate-200 bg-white text-left shadow-sm transition-shadow hover:shadow dark:border-slate-700 dark:bg-slate-800"
    >
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2.5 dark:border-slate-700 dark:bg-slate-900/40">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-500 dark:text-slate-400">#{b.id.slice(-6).toUpperCase()}</span>
          {b.isVip && (
            <span className="shrink-0 text-amber-500" title="VIP guest">
              👑
            </span>
          )}
          <span className="rounded bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-400 shadow-sm dark:bg-slate-800 dark:text-slate-500">
            Booked: {formatDateShort(b.createdAt)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <ChannelBadge source={b.source} />
          <Badge tone={statuses.size === 1 ? b.status : 'checked_in'}>{groupLabel}</Badge>
          {/* §user request — "har booking ke upar 3 dots chahiye jispe click karte hi ye saare
              options khule": opens MoreActionsPanel without triggering the card's own onClick
              (stopPropagation), since the card itself is one big clickable surface. */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onMoreActions();
            }}
            aria-label="More actions"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-400 dark:hover:bg-slate-700"
          >
            ⋯
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2.5 px-4 py-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700 dark:bg-brand-500/20 dark:text-brand-300">
          {b.guestName.slice(0, 2).toUpperCase()}
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm font-bold text-slate-900 dark:text-white">{b.guestName}</p>
            {b.billToCompanyName && (
              <span className="shrink-0 rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
                🏢 Corporate
              </span>
            )}
          </div>
          {b.guestPhone && <p className="truncate text-xs text-brand-600 dark:text-brand-400">{b.guestPhone}</p>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 border-t border-slate-100 px-4 py-3 dark:border-slate-700">
        <div>
          <p className="text-[11px] text-slate-400 dark:text-slate-500">Check In</p>
          <p className="text-sm font-bold text-slate-900 dark:text-white">{formatDateShort(b.checkIn)}</p>
        </div>
        <div className="text-right">
          <p className="text-[11px] text-slate-400 dark:text-slate-500">Check Out</p>
          <p className="text-sm font-bold text-slate-900 dark:text-white">{formatDateShort(b.checkOut)}</p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-4 py-3 dark:border-slate-700">
        <p className="min-w-0 truncate text-sm text-slate-600 dark:text-slate-300">🛏 {roomSummary}</p>
        <div className="flex shrink-0 items-center gap-1">
          {roomNumbers.slice(0, 2).map((n) => (
            <span key={n} className="rounded-md bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
              {n}
            </span>
          ))}
          {roomNumbers.length > 2 && (
            <span className="rounded-md border border-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-500 dark:border-slate-600 dark:text-slate-400">
              +{roomNumbers.length - 2}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-4 py-3 dark:border-slate-700">
        <div className="flex items-center gap-4">
          <div>
            <p className="text-[11px] text-slate-400 dark:text-slate-500">Total Amount</p>
            <p className="text-sm font-bold text-slate-900 dark:text-white">₹{grandTotal.toFixed(0)}</p>
          </div>
          {due > 0 && (
            <div>
              <p className="text-[11px] text-slate-400 dark:text-slate-500">Due</p>
              <p className="text-sm font-bold text-red-500">₹{due.toFixed(0)}</p>
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
            {b.nights} Night{b.nights === 1 ? '' : 's'}
          </span>
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
            {activeCount}/{group.length} Reserved
          </span>
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-200 text-slate-400 dark:border-slate-600">→</span>
        </div>
      </div>
    </div>
  );
}

