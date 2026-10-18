import { useEffect, useState } from 'react';
import { query, ApiError } from '../api';
import { useAuth } from '../AuthContext';
import { Badge, Button, Card } from '../components/ui';
import { computeInvoiceTotals } from '../invoice';
import { formatDateShort, formatDateTimeShort } from '../dateFormat';
import { ChannelIcon } from './channel-manager/ChannelBadge';
import { SOURCE_LABEL } from './channel-manager/ota-labels';
import { CheckInModal } from './checkin/CheckInModal';
import { AddPaymentModal } from './AddPaymentModal';
import type { Booking, Room } from '../types';

const STATUS_LABEL: Record<Booking['status'], string> = {
  confirmed: 'Upcoming',
  checked_in: 'Checked In',
  checked_out: 'Checked Out',
  cancelled: 'Cancelled',
};

function groupStatus(bookings: Booking[]): Booking['status'] | 'partial' {
  const statuses = new Set(bookings.map((b) => b.status));
  if (statuses.size === 1) return bookings[0].status;
  if ([...statuses].every((s) => s === 'checked_in' || s === 'confirmed')) return 'partial';
  return bookings[0].status;
}

/** One room's own row in the reservation — its own status, own rate, own "Check in" (so a
 * multi-room reservation's "Partial Check-in" is just checking in some rooms and not others,
 * nothing more than each Booking row's own existing status machinery). */
function RoomRow({
  booking,
  room,
  onCheckIn,
  onAddPayment,
}: {
  booking: Booking;
  room: Room | undefined;
  onCheckIn: () => void;
  onAddPayment: () => void;
}) {
  const totals = computeInvoiceTotals({
    totalAmount: Number(booking.totalAmount),
    lineItems: booking.lineItems ?? [],
    discountAmount: booking.discountAmount ? Number(booking.discountAmount) : null,
    gstExempt: booking.gstExempt,
  });
  const due = Math.max(0, totals.grandTotal - Number(booking.paidAmount ?? 0));
  return (
    <div className="rounded-xl border border-slate-200 p-3.5 dark:border-slate-700">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-900 dark:text-white">
            Room {room?.roomNumber ?? '—'}
            <span className="ml-2 text-xs font-normal text-slate-400 dark:text-slate-500">
              {formatDateShort(booking.checkIn)} – {formatDateShort(booking.checkOut)}
            </span>
          </p>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{room?.roomCategory?.name ?? '—'} · ₹{totals.grandTotal.toFixed(2)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge tone={booking.status}>{STATUS_LABEL[booking.status]}</Badge>
          {booking.status === 'confirmed' && (
            <button onClick={onCheckIn} className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">
              Check in
            </button>
          )}
        </div>
      </div>
      {due > 0 && (
        <div className="mt-2 flex items-center justify-between border-t border-slate-50 pt-2 dark:border-slate-700/60">
          <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">₹{due.toFixed(2)} due</span>
          <button onClick={onAddPayment} className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">
            Add Payment
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * §user request, with a reference app's own multi-room Booking Details screen as the explicit
 * target — every room this reservation covers, each checkable in on its own ("Partial
 * Check-in"), a shared guest/contact/source info grid, and per-room payment/due (payments are
 * still tracked per Booking row — there's no cross-room ledger account in this data model, so
 * "Add Payment" lives on each room exactly like it already does everywhere else in the app).
 */
export function ReservationDetailModal({
  hotelId,
  bookings,
  onClose,
  onChanged,
}: {
  hotelId: string;
  bookings: Booking[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const { token } = useAuth();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [checkingInBooking, setCheckingInBooking] = useState<Booking | null>(null);
  const [payingBooking, setPayingBooking] = useState<Booking | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    query<Room[]>('hotels.listRooms', { hotelId }, token ?? undefined)
      .then((r) => {
        if (!cancelled) setRooms(r);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load rooms'));
    return () => {
      cancelled = true;
    };
  }, [hotelId, token]);

  const first = bookings[0];
  const status = groupStatus(bookings);
  const grandTotal = bookings.reduce((sum, b) => {
    const totals = computeInvoiceTotals({
      totalAmount: Number(b.totalAmount),
      lineItems: b.lineItems ?? [],
      discountAmount: b.discountAmount ? Number(b.discountAmount) : null,
      gstExempt: b.gstExempt,
    });
    return sum + totals.grandTotal;
  }, 0);
  const paid = bookings.reduce((sum, b) => sum + Number(b.paidAmount ?? 0), 0);
  const due = Math.max(0, grandTotal - paid);
  const firstPending = bookings.find((b) => b.status === 'confirmed');

  function roomFor(booking: Booking) {
    return rooms.find((r) => r.id === booking.assignedRoomId);
  }

  return (
    // §bugfix — CheckInModal/AddPaymentModal render their own full-screen overlay on top, but
    // were previously mounted as React children of this backdrop's onClick={onClose}; any click
    // inside them (e.g. the "Next · Payment" submit button) bubbled through the React tree and
    // instantly closed this whole detail view mid-flow. Rendering them in a sibling Fragment
    // (outside the backdrop) keeps them visually nested but out of its click-bubble path.
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <Card className="max-h-[90vh] overflow-y-auto">
          <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-700">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">Booking Details</h3>
              <span className="mt-1 inline-block">
                <Badge tone={status === 'partial' ? 'checked_in' : status}>{status === 'partial' ? 'Partially Checked In' : STATUS_LABEL[status]}</Badge>
              </span>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300">
              ✕
            </button>
          </div>

          {error && <p className="px-5 pt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

          {firstPending && (
            <div className="border-b border-slate-100 px-5 py-3 dark:border-slate-700">
              <Button type="button" className="w-full" onClick={() => setCheckingInBooking(firstPending)}>
                Start Check-in
              </Button>
            </div>
          )}

          <div className="px-5 py-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Rooms ({bookings.length})</p>
            <div className="space-y-2">
              {bookings.map((b) => (
                <RoomRow key={b.id} booking={b} room={roomFor(b)} onCheckIn={() => setCheckingInBooking(b)} onAddPayment={() => setPayingBooking(b)} />
              ))}
            </div>
          </div>

          <div className="divide-y divide-slate-100 border-t border-slate-100 px-5 dark:divide-slate-700 dark:border-slate-700">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 py-3 text-sm">
              <div>
                <p className="text-xs text-slate-400 dark:text-slate-500">Guest Name</p>
                <p className="font-medium text-slate-900 dark:text-white">{first.guestName}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400 dark:text-slate-500">Source</p>
                <p className="flex items-center gap-1.5 font-medium text-slate-900 dark:text-white">
                  <ChannelIcon source={first.source} className="h-4 w-4" /> {SOURCE_LABEL[first.source] ?? first.source}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-400 dark:text-slate-500">Check-in</p>
                <p className="font-medium text-slate-900 dark:text-white">{formatDateShort(first.checkIn)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400 dark:text-slate-500">Check-out</p>
                <p className="font-medium text-slate-900 dark:text-white">{formatDateShort(first.checkOut)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400 dark:text-slate-500">Contact No.</p>
                <p className="font-medium text-slate-900 dark:text-white">{first.guestPhone ?? 'N/A'}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400 dark:text-slate-500">Email</p>
                <p className="font-medium text-slate-900 dark:text-white">{first.guestEmail ?? 'N/A'}</p>
              </div>
              <div className="col-span-2">
                <p className="text-xs text-slate-400 dark:text-slate-500">Special Request</p>
                <p className="font-medium text-slate-900 dark:text-white">{first.specialRequest ?? 'N/A'}</p>
              </div>
              <div className="col-span-2">
                <p className="text-xs text-slate-400 dark:text-slate-500">Booking Date</p>
                <p className="font-medium text-slate-900 dark:text-white">{formatDateTimeShort(first.createdAt)}</p>
              </div>
            </div>
          </div>

          <div className="space-y-1.5 border-t border-slate-100 px-5 py-4 text-sm dark:border-slate-700">
            <div className="flex justify-between text-slate-500 dark:text-slate-400">
              <span>Booking Amount</span>
              <span className="text-slate-900 dark:text-white">₹{grandTotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-slate-500 dark:text-slate-400">
              <span>Paid</span>
              <span className="text-slate-900 dark:text-white">₹{paid.toFixed(2)}</span>
            </div>
            <div className={`flex items-center justify-between font-medium ${due > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
              <span>Due</span>
              <span>{due > 0 ? `₹${due.toFixed(2)}` : 'Paid in full'}</span>
            </div>
            {due > 0 && (
              <p className="pt-1 text-xs text-slate-400 dark:text-slate-500">Add a payment against a specific room below to settle its own due.</p>
            )}
          </div>
        </Card>
      </div>
    </div>

      {checkingInBooking && (
        <CheckInModal
          hotelId={hotelId}
          reservation={checkingInBooking}
          assignedRoomNumber={roomFor(checkingInBooking)?.roomNumber}
          onClose={() => setCheckingInBooking(null)}
          onDone={() => {
            setCheckingInBooking(null);
            onChanged();
          }}
        />
      )}
      {payingBooking && (
        <AddPaymentModal booking={payingBooking} onClose={() => setPayingBooking(null)} onDone={onChanged} />
      )}
    </>
  );
}
