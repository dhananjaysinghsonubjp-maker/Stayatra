import { useEffect, useMemo, useState } from 'react';
import { mutate, query, ApiError } from '../api';
import { useAuth } from '../AuthContext';
import { Button, Card, EmptyState, PageHeader } from '../components/ui';
import { computeInvoiceTotals } from '../invoice';
import { formatDateShort } from '../dateFormat';
import { ReservationDetailModal } from './ReservationDetailModal';
import { MoreActionsPanel, type MoreActionsView } from './MoreActionsPanel';
import { CreateReservationModal } from './checkin/CreateReservationModal';
import type { Booking, Hotel, InHouseRow, RatePlan, Room, RoomCategory } from '../types';

// §user request — "Extend Stay checkout time jo hotel ka hota hai tab waha par show ho jayega jab
// guest ka check-out ka time hoga": not just "today" the whole day — only once the clock actually
// reaches the hotel's own configured checkout time (Hotel Details' checkOutTime), the same "has
// this room's checkout hour actually passed" idea the existing cleaning-discrepancy delay logic
// already uses, just driven by the hotel's real setting instead of a hardcoded hour.
function hasReachedCheckout(checkOutIso: string, checkOutTime: string | null | undefined): boolean {
  const checkOutDateKey = checkOutIso.slice(0, 10);
  const todayKey = new Date().toLocaleDateString('en-CA');
  if (checkOutDateKey > todayKey) return false;
  if (checkOutDateKey < todayKey) return true;
  const [h, m] = (checkOutTime ?? '11:00').split(':').map(Number);
  const threshold = new Date();
  threshold.setHours(h || 0, m || 0, 0, 0);
  return new Date() >= threshold;
}

export function InHouse({ hotelId, hotel }: { hotelId: string; hotel: Hotel }) {
  const { token, role } = useAuth();
  const [rows, setRows] = useState<InHouseRow[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [categories, setCategories] = useState<RoomCategory[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [ratePlans, setRatePlans] = useState<RatePlan[]>([]);
  const [error, setError] = useState<string | null>(null);
  // §user request, with the same full Booking Details page Bookings/Calendar already open as the
  // target — "Manage" used to open the old, narrower EditBookingModal; it now opens the exact same
  // page + More Actions + Edit flow those screens use.
  const [viewingGroupKey, setViewingGroupKey] = useState<string | null>(null);
  const [actionsGroupKey, setActionsGroupKey] = useState<string | null>(null);
  const [actionsInitialView, setActionsInitialView] = useState<MoreActionsView | undefined>(undefined);
  const [editingGroup, setEditingGroup] = useState<Booking[] | null>(null);
  const canResolve = ['owner', 'manager'].includes(role('pms') ?? '');
  const canManage = ['owner', 'manager', 'front_desk'].includes(role('pms') ?? '');

  async function refresh() {
    try {
      const [inHouse, b, c, r, rp] = await Promise.all([
        query<InHouseRow[]>('bookings.listInHouse', { hotelId }, token ?? undefined),
        query<Booking[]>('bookings.listReservations', { hotelId }, token ?? undefined),
        query<RoomCategory[]>('hotels.listRoomCategories', { hotelId }, token ?? undefined),
        query<Room[]>('hotels.listRooms', { hotelId }, token ?? undefined),
        query<RatePlan[]>('rates.listAllRatePlansForHotel', { hotelId }, token ?? undefined),
      ]);
      setRows(inHouse);
      setBookings(b);
      setCategories(c);
      setRooms(r);
      setRatePlans(rp);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load in-house guests');
    }
  }
  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, 15000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId]);

  async function resolveDelay(bookingId: string) {
    const note = prompt('Note for resolving this delay?');
    if (!note) return;
    await mutate('bookings.resolveDelay', { bookingId, note }, token ?? undefined);
    await refresh();
  }

  const [checkingOutId, setCheckingOutId] = useState<string | null>(null);
  async function checkOutGuest(bookingId: string, guestName: string, roomNumber: string) {
    if (!confirm(`Check out ${guestName} from Room ${roomNumber}? The room will move to Housekeeping until it's cleaned.`)) return;
    setCheckingOutId(bookingId);
    try {
      await mutate('bookings.checkOutGuest', { hotelId, bookingId }, token ?? undefined);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Check-out failed');
    } finally {
      setCheckingOutId(null);
    }
  }

  const delayedCount = rows.filter((r) => r.delayed).length;
  const roomsById = useMemo(() => new Map(rooms.map((rm) => [rm.id, rm])), [rooms]);
  const viewingGroup = useMemo(
    () => (viewingGroupKey ? bookings.filter((row) => (row.reservationGroupId ?? row.id) === viewingGroupKey) : null),
    [viewingGroupKey, bookings],
  );
  const actionsGroup = useMemo(
    () => (actionsGroupKey ? bookings.filter((row) => (row.reservationGroupId ?? row.id) === actionsGroupKey) : null),
    [actionsGroupKey, bookings],
  );

  return (
    <div>
      <PageHeader
        title="In-House Guests"
        subtitle={`${rows.length} currently staying${delayedCount ? ` · ${delayedCount} past cleaning deadline` : ''}`}
      />
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No guests currently in-house" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            {/* §user request, with Room View's own table as the exact target — same header/row
                sizing, uppercase status pill, a Payment-style due/paid pill instead of plain
                coloured text, and real buttons for Manage/Check-out instead of text links. */}
            <table className="w-full text-sm [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
              <thead>
                <tr className="bg-brand-600 text-left text-xs font-semibold text-white">
                  <th className="px-5 py-3">Room</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Guest</th>
                  <th className="px-5 py-3">Check In</th>
                  <th className="px-5 py-3">Check Out</th>
                  <th className="px-5 py-3">Balance</th>
                  <th className="px-5 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const totals = computeInvoiceTotals({
                    totalAmount: Number(r.booking.totalAmount),
                    lineItems: r.booking.lineItems ?? [],
                    discountAmount: r.booking.discountAmount ? Number(r.booking.discountAmount) : null,
                    gstExempt: r.booking.gstExempt,
                  });
                  const due = Math.max(0, totals.grandTotal - Number(r.booking.paidAmount ?? 0));
                  const rowBg = i % 2 === 0 ? 'bg-white dark:bg-slate-800' : 'bg-slate-50 dark:bg-slate-800/60';
                  const stripStyle = r.delayed ? 'border-l-red-500' : 'border-l-transparent';
                  return (
                    <tr
                      key={r.booking.id}
                      className={`${rowBg} border-b border-l-4 border-slate-100 last:border-0 dark:border-slate-700 ${stripStyle}`}
                    >
                      <td className="px-5 py-3.5 font-bold text-slate-900 dark:text-white">{r.room.roomNumber}</td>
                      <td className="px-5 py-3.5">
                        {r.delayed ? (
                          <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-700 dark:bg-red-900/50 dark:text-red-300">
                            Delayed
                          </span>
                        ) : (
                          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
                            In-House
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 font-medium text-slate-900 dark:text-white">{r.booking.guestName}</td>
                      <td className="px-5 py-3.5 text-slate-600 dark:text-slate-300">{formatDateShort(r.booking.checkIn)}</td>
                      <td className="px-5 py-3.5 text-slate-600 dark:text-slate-300">{formatDateShort(r.booking.checkOut)}</td>
                      <td className="px-5 py-3.5">
                        {due > 0 ? (
                          <div className="flex flex-col gap-0.5">
                            <span className="w-fit rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                              ₹{due % 1 === 0 ? due : due.toFixed(2)} due
                            </span>
                            <span className="text-[10px] text-slate-400 dark:text-slate-500">₹{Number(r.booking.paidAmount ?? 0).toFixed(2)} paid</span>
                          </div>
                        ) : (
                          <span className="w-fit rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                            ₹{Number(r.booking.paidAmount ?? 0).toFixed(2)}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <div className="flex justify-end gap-2">
                          {r.delayed && canResolve && (
                            <Button variant="secondary" className="text-xs" onClick={() => resolveDelay(r.booking.id)}>
                              Resolve
                            </Button>
                          )}
                          {/* §user request — "unka departing aa raha hai, agar unko stay extend
                              karna ho toh Manage ke aage Extend Stay aa jana chahiye": opens the
                              same Modify Stay panel More Actions already has — its checkout date
                              and rate-per-night already default from this booking's own current
                              stay, so extending by a night keeps the same agreed rate. */}
                          {canManage && hasReachedCheckout(r.booking.checkOut, hotel.checkOutTime) && (
                            <Button
                              variant="secondary"
                              className="text-xs"
                              onClick={() => {
                                setActionsGroupKey(r.booking.reservationGroupId ?? r.booking.id);
                                setActionsInitialView('modifystay');
                              }}
                            >
                              Extend Stay
                            </Button>
                          )}
                          {canManage && (
                            <Button variant="secondary" className="text-xs" onClick={() => setViewingGroupKey(r.booking.reservationGroupId ?? r.booking.id)}>
                              Manage
                            </Button>
                          )}
                          {canManage && (
                            <Button
                              variant="secondary"
                              className="text-xs"
                              disabled={checkingOutId === r.booking.id}
                              onClick={() => checkOutGuest(r.booking.id, r.booking.guestName, r.room.roomNumber)}
                            >
                              {checkingOutId === r.booking.id ? 'Checking out…' : 'Check-out Guest'}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {viewingGroup && viewingGroup.length > 0 && (
        <ReservationDetailModal
          hotelId={hotelId}
          bookings={viewingGroup}
          rooms={rooms}
          ratePlans={ratePlans}
          onClose={() => setViewingGroupKey(null)}
          onChanged={() => void refresh()}
          onMoreActions={(initialView) => {
            setActionsGroupKey(viewingGroup[0].reservationGroupId ?? viewingGroup[0].id);
            setActionsInitialView(initialView);
          }}
          onEdit={() => setEditingGroup(viewingGroup)}
        />
      )}
      {actionsGroup && actionsGroup.length > 0 && (
        <MoreActionsPanel
          hotelId={hotelId}
          group={actionsGroup}
          roomsById={roomsById}
          categories={categories}
          ratePlans={ratePlans}
          initialView={actionsInitialView}
          onClose={() => {
            setActionsGroupKey(null);
            setActionsInitialView(undefined);
          }}
          onChanged={() => void refresh()}
        />
      )}
      {editingGroup && editingGroup.length > 0 && (
        <CreateReservationModal
          hotelId={hotelId}
          editGroup={editingGroup}
          onClose={() => setEditingGroup(null)}
          onDone={() => {
            setEditingGroup(null);
            void refresh();
          }}
        />
      )}
    </div>
  );
}
