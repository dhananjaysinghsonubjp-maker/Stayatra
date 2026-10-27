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
import { ChannelIcon } from './channel-manager/ChannelBadge';
import { formatDateShort } from '../dateFormat';
import type { Booking, RoomCategory } from '../types';

type ListTab = 'upcoming' | 'checked_in' | 'history';
const TAB_LABEL: Record<ListTab, string> = { upcoming: 'Upcoming', checked_in: 'Checked In', history: 'History' };
const STATUS_LABEL: Record<Booking['status'], string> = {
  confirmed: 'Upcoming',
  checked_in: 'Checked In',
  checked_out: 'Checked Out',
  cancelled: 'Cancelled',
};

export function Bookings({ hotelId, hasPms = true }: { hotelId: string; hasPms?: boolean }) {
  const { token } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [categories, setCategories] = useState<RoomCategory[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [payingBooking, setPayingBooking] = useState<Booking | null>(null);
  const [checkingInBooking, setCheckingInBooking] = useState<Booking | null>(null);
  const [viewingBooking, setViewingBooking] = useState<Booking | null>(null);
  const [viewingGroupKey, setViewingGroupKey] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [sourceFilter, setSourceFilter] = useState('all');
  const [listTab, setListTab] = useState<ListTab>('upcoming');
  const [search, setSearch] = useState('');

  async function refresh() {
    try {
      const [b, c] = await Promise.all([
        query<Booking[]>('bookings.listReservations', { hotelId }, token ?? undefined),
        query<RoomCategory[]>('hotels.listRoomCategories', { hotelId }, token ?? undefined),
      ]);
      setBookings(b);
      setCategories(c);
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
      history: filtered.filter((b) => b.status === 'checked_out' || b.status === 'cancelled').length,
    }),
    [filtered],
  );
  const tabFiltered = useMemo(
    () =>
      filtered.filter((b) =>
        listTab === 'upcoming' ? b.status === 'confirmed' : listTab === 'checked_in' ? b.status === 'checked_in' : b.status === 'checked_out' || b.status === 'cancelled',
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

  // Derived live (not a snapshot) so the open detail modal reflects a check-in/payment right
  // after it happens, instead of showing stale data until the modal is closed and reopened.
  const viewingGroup = useMemo(
    () => (viewingGroupKey ? bookings.filter((row) => (row.reservationGroupId ?? row.id) === viewingGroupKey) : null),
    [viewingGroupKey, bookings],
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
        <div className="space-y-2.5">
          {searchedRows.map((group) => {
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
            const roomType = categories.find((c) => c.id === b.roomCategoryId)?.name ?? '—';
            const statuses = new Set(group.map((row) => row.status));
            const groupLabel = statuses.size === 1 ? STATUS_LABEL[b.status] : 'Partially Checked In';
            return (
              <button
                key={group.length > 1 ? b.reservationGroupId! : b.id}
                onClick={() => (group.length > 1 ? setViewingGroupKey(b.reservationGroupId ?? b.id) : setViewingBooking(b))}
                className="flex w-full items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-shadow hover:shadow dark:border-slate-700 dark:bg-slate-800"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <ChannelIcon source={b.source} className="mt-0.5 h-8 w-8" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate text-sm font-bold text-slate-900 dark:text-white">{b.guestName}</p>
                      {b.billToCompanyName && (
                        <span className="shrink-0 rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
                          🏢 Corporate
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                      {group.length > 1 ? `${group.length} Rooms` : roomType} · {formatDateShort(b.checkIn)} – {formatDateShort(b.checkOut)}
                    </p>
                    {b.guestPhone && <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">{b.guestPhone}</p>}
                    {due > 0 && <p className="mt-1 text-xs font-semibold text-amber-600 dark:text-amber-400">₹{due.toFixed(2)} due</p>}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <Badge tone={statuses.size === 1 ? b.status : 'checked_in'}>{groupLabel}</Badge>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500 dark:bg-slate-700 dark:text-slate-400">{b.nights}N</span>
                  <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500">#{b.id.slice(-6).toUpperCase()}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

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

