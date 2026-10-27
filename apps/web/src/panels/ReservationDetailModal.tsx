import { useEffect, useState } from 'react';
import { query, mutate, ApiError } from '../api';
import { useAuth } from '../AuthContext';
import { Badge, Button, Card, inputClass } from '../components/ui';
import { computeInvoiceTotals } from '../invoice';
import { formatDateShort, formatDateTimeShort } from '../dateFormat';
import { istDateKey } from '../components/DateRangePicker';
import { ChannelIcon } from './channel-manager/ChannelBadge';
import { SOURCE_LABEL } from './channel-manager/ota-labels';
import { CheckInModal } from './checkin/CheckInModal';
import { AddPaymentModal } from './AddPaymentModal';
import { GroupPaymentModal } from './GroupPaymentModal';
import { PaymentHistory, type PaymentHistoryEntry } from './PaymentHistory';
import { InvoicePrintView } from './InvoicePrintView';
import type { Booking, Room, RatePlan } from '../types';

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
  today,
  canManage,
  candidateRooms,
  onCheckIn,
  onAddPayment,
  onReassignRoom,
  onRemoveRoom,
  onAddCharge,
  onRemoveCharge,
  onPrintInvoice,
}: {
  booking: Booking;
  room: Room | undefined;
  today: string;
  canManage: boolean;
  candidateRooms: Room[];
  onCheckIn: () => void;
  onAddPayment: () => void;
  onReassignRoom: (roomId: string) => Promise<void>;
  onRemoveRoom: () => void;
  onAddCharge: (description: string, quantity: number, unitPrice: number) => Promise<void>;
  onRemoveCharge: (lineItemId: string) => Promise<void>;
  onPrintInvoice: () => void;
}) {
  const [reassigning, setReassigning] = useState(false);
  const [pickedRoomId, setPickedRoomId] = useState('');
  const [saving, setSaving] = useState(false);
  const [reassignError, setReassignError] = useState<string | null>(null);
  const [addingCharge, setAddingCharge] = useState(false);
  const [chargeDesc, setChargeDesc] = useState('');
  const [chargeQty, setChargeQty] = useState(1);
  const [chargeUnitPrice, setChargeUnitPrice] = useState(0);
  const [chargeSaving, setChargeSaving] = useState(false);
  const [chargeError, setChargeError] = useState<string | null>(null);

  async function confirmAddCharge() {
    if (!chargeDesc.trim()) return;
    setChargeSaving(true);
    setChargeError(null);
    try {
      await onAddCharge(chargeDesc.trim(), chargeQty, chargeUnitPrice);
      setAddingCharge(false);
      setChargeDesc('');
      setChargeQty(1);
      setChargeUnitPrice(0);
    } catch (err) {
      setChargeError(err instanceof ApiError ? err.message : 'Failed to add charge');
    } finally {
      setChargeSaving(false);
    }
  }

  const totals = computeInvoiceTotals({
    totalAmount: Number(booking.totalAmount),
    lineItems: booking.lineItems ?? [],
    discountAmount: booking.discountAmount ? Number(booking.discountAmount) : null,
    gstExempt: booking.gstExempt,
  });
  const due = Math.max(0, totals.grandTotal - Number(booking.paidAmount ?? 0));
  // §user request — "Start Check-in block rahega jab tak date na aaye": a reservation days out
  // still shouldn't invite an accidental early check-in click, but the just-added dates-editable
  // check-in flow is exactly how a genuine early arrival gets handled — so this stays reachable
  // (muted, smaller) instead of fully disabled.
  const isFutureStay = booking.status === 'confirmed' && booking.checkIn.slice(0, 10) > today;

  async function confirmReassign() {
    if (!pickedRoomId) return;
    setSaving(true);
    setReassignError(null);
    try {
      await onReassignRoom(pickedRoomId);
      setReassigning(false);
      setPickedRoomId('');
    } catch (err) {
      setReassignError(err instanceof ApiError ? err.message : 'Failed to change room');
    } finally {
      setSaving(false);
    }
  }

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
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {room?.roomCategory?.name ?? '—'} · ₹{totals.grandTotal.toFixed(2)}
            {/* §user request — "har booking ka invoice chahiye": a group reservation's own rooms
                had no invoice at all before — only a standalone single-room booking did
                (BookingViewModal's "Print Invoice"). Same InvoicePrintView, reused per room
                here, works regardless of status (confirmed/checked_in/checked_out — a guest can
                still want their invoice after checkout). */}
            <button onClick={onPrintInvoice} className="ml-2 text-brand-600 hover:underline dark:text-brand-400">
              🧾 Invoice
            </button>
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <div className="flex items-center gap-2">
            <Badge tone={booking.status}>{STATUS_LABEL[booking.status]}</Badge>
            {booking.status === 'confirmed' && !isFutureStay && (
              <button onClick={onCheckIn} className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">
                Check in
              </button>
            )}
          </div>
          {booking.status === 'confirmed' && isFutureStay && (
            <div className="flex flex-col items-end">
              <span className="text-[11px] text-slate-400 dark:text-slate-500">Check-in opens {formatDateShort(booking.checkIn)}</span>
              <button onClick={onCheckIn} className="text-[11px] font-medium text-slate-400 hover:text-brand-600 hover:underline dark:text-slate-500 dark:hover:text-brand-400">
                Check in early
              </button>
            </div>
          )}
        </div>
      </div>

      {/* §user request — "Neeraj ji ki booking mein rooms ko edit bhi kar sakte hain": swap
          this room before check-in, same-category available rooms only (server re-checks dates). */}
      {booking.status === 'confirmed' && (
        <div className="mt-2 border-t border-slate-50 pt-2 dark:border-slate-700/60">
          {!reassigning ? (
            <div className="flex items-center gap-3">
              <button
                onClick={() => setReassigning(true)}
                className="text-xs font-medium text-slate-500 hover:text-brand-600 hover:underline dark:text-slate-400 dark:hover:text-brand-400"
              >
                Change room
              </button>
              {/* §user request — removing a room from a group booking is a cancellation of that
                  one room's own Booking row, same weight as cancelling any reservation — owner/
                  manager only, same as the Cancel action elsewhere in this app. */}
              {canManage && booking.reservationGroupId && (
                <button onClick={onRemoveRoom} className="text-xs font-medium text-slate-400 hover:text-red-600 hover:underline dark:hover:text-red-400">
                  Remove room
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <select className={`${inputClass} w-auto text-xs`} value={pickedRoomId} onChange={(e) => setPickedRoomId(e.target.value)}>
                <option value="">— pick a room —</option>
                {candidateRooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.roomNumber}
                  </option>
                ))}
              </select>
              <Button variant="secondary" className="px-2.5 py-1 text-xs" disabled={!pickedRoomId || saving} onClick={confirmReassign}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
              <button
                onClick={() => {
                  setReassigning(false);
                  setReassignError(null);
                }}
                className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
              >
                Cancel
              </button>
              {reassignError && <p className="w-full text-xs text-red-600">{reassignError}</p>}
            </div>
          )}
        </div>
      )}

      {/* §user request — "Neeraj ji ke Room 102 mein extra bedding laga, ya extra charges":
          room-specific add-ons the booker's one group payment above still has to account for —
          each lands on this exact room's own invoice (InvoiceLineItem), same field the check-in
          wizard's "Add Extra Charges" already writes to, just reachable any time now, not only
          at check-in. */}
      {(booking.lineItems?.length ?? 0) > 0 && (
        <div className="mt-2 space-y-1 border-t border-slate-50 pt-2 dark:border-slate-700/60">
          {booking.lineItems!.map((li) => (
            <div key={li.id} className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
              <span>
                {li.description} {li.quantity > 1 ? `× ${li.quantity}` : ''}
              </span>
              <span className="flex items-center gap-2">
                ₹{Number(li.amount).toFixed(2)}
                <button onClick={() => onRemoveCharge(li.id)} className="text-slate-400 hover:text-red-600 dark:hover:text-red-400" title="Remove charge">
                  ✕
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="mt-2 border-t border-slate-50 pt-2 dark:border-slate-700/60">
        {!addingCharge ? (
          <button
            onClick={() => setAddingCharge(true)}
            className="text-xs font-medium text-slate-500 hover:text-brand-600 hover:underline dark:text-slate-400 dark:hover:text-brand-400"
          >
            + Add charge
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <input
              className={`${inputClass} w-32 text-xs`}
              placeholder="e.g. Extra bedding"
              value={chargeDesc}
              onChange={(e) => setChargeDesc(e.target.value)}
              autoFocus
            />
            <input
              type="number"
              min={1}
              className={`${inputClass} w-14 text-xs`}
              value={chargeQty}
              onChange={(e) => setChargeQty(Math.max(1, Number(e.target.value)))}
              title="Quantity"
            />
            <input
              type="number"
              min={0}
              className={`${inputClass} w-20 text-xs`}
              value={chargeUnitPrice}
              onChange={(e) => setChargeUnitPrice(Number(e.target.value))}
              title="Price"
            />
            <Button variant="secondary" className="px-2.5 py-1 text-xs" disabled={!chargeDesc.trim() || chargeSaving} onClick={confirmAddCharge}>
              {chargeSaving ? 'Adding…' : 'Add'}
            </Button>
            <button
              onClick={() => {
                setAddingCharge(false);
                setChargeError(null);
              }}
              className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
            >
              Cancel
            </button>
            {chargeError && <p className="w-full text-xs text-red-600">{chargeError}</p>}
          </div>
        )}
      </div>

      {due > 0 && (
        <div className="mt-2 flex items-center justify-between border-t border-slate-50 pt-2 dark:border-slate-700/60">
          <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">₹{due.toFixed(2)} due</span>
          {/* §user request — "Neeraj ji room-wise payment nahi karte": a room inside a group
              reservation has no payment action of its own anymore — the one "Add Payment" button
              against the whole booking (below) is the only entry point, same money either way,
              just not picked room-by-room by staff. An ordinary single-room booking still gets
              its own link here (there's no "group" to collect against otherwise). */}
          {!booking.reservationGroupId && (
            <button onClick={onAddPayment} className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">
              Add Payment
            </button>
          )}
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
  const { token, role } = useAuth();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [ratePlans, setRatePlans] = useState<RatePlan[]>([]);
  const [checkingInBooking, setCheckingInBooking] = useState<Booking | null>(null);
  const [payingBooking, setPayingBooking] = useState<Booking | null>(null);
  const [printingBooking, setPrintingBooking] = useState<Booking | null>(null);
  const [payingGroup, setPayingGroup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingRoom, setAddingRoom] = useState(false);
  const [newRoomId, setNewRoomId] = useState('');
  const [newRatePlanId, setNewRatePlanId] = useState('');
  const [newAmount, setNewAmount] = useState(0);
  const [addRoomSaving, setAddRoomSaving] = useState(false);
  const [addRoomError, setAddRoomError] = useState<string | null>(null);
  // §user request — "Remove room" cancels that room's own Booking row (reservationsManager-gated
  // server-side, same as cancelling any booking), so only an owner/manager sees it — a front_desk
  // can still Change Room (a swap, nothing cancelled) and Add Room.
  const canManage = ['owner', 'manager'].includes(role('pms') ?? '') || ['owner', 'manager'].includes(role('channel_manager') ?? '');

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      query<Room[]>('hotels.listRooms', { hotelId }, token ?? undefined),
      query<RatePlan[]>('rates.listAllRatePlansForHotel', { hotelId }, token ?? undefined),
    ])
      .then(([r, rp]) => {
        if (!cancelled) {
          setRooms(r);
          setRatePlans(rp);
        }
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
  // §user request — "advance ke baad payment add karein toh bulk amount ho jata hai, pata nahi
  // chalta kab kya hua": a group's one "Add Payment" (addGroupPayment) lands as a separate
  // Payment row per room, all sharing the exact same collectedAt (one DB transaction) — merging
  // by that timestamp+method+reference turns those back into the single installment the booker
  // actually paid, instead of fragmenting one payment into one confusing line per room.
  const paymentTimeline: PaymentHistoryEntry[] = (() => {
    const merged = new Map<string, PaymentHistoryEntry & { rooms: Set<string> }>();
    for (const b of bookings) {
      const roomNumber = roomFor(b)?.roomNumber ?? '—';
      for (const p of b.payments ?? []) {
        const key = `${p.collectedAt}|${p.method}|${p.referenceNumber ?? ''}`;
        const existing = merged.get(key);
        if (existing) {
          existing.amount += Number(p.amount);
          existing.rooms.add(roomNumber);
        } else {
          merged.set(key, {
            key,
            amount: Number(p.amount),
            collectedAt: p.collectedAt,
            method: p.method,
            referenceNumber: p.referenceNumber,
            rooms: new Set([roomNumber]),
          });
        }
      }
    }
    return [...merged.values()].map((e) => ({ ...e, roomLabel: e.rooms.size > 1 ? `Rooms ${[...e.rooms].join(', ')}` : undefined }));
  })();
  const firstPending = bookings.find((b) => b.status === 'confirmed');
  const today = istDateKey(new Date().toISOString());
  // §bugfix — "Booking Details: Neeraj Gupta" at the top used to read straight off
  // bookings[0].guestName/guestPhone, which is only the booker's info until that room's own
  // check-in overwrites it with whoever actually checked into Room 1 — after that, the group
  // summary silently started showing a random room's guest instead of who placed the booking.
  // bookedByName/bookedByPhone (set once at creation, untouched by any room's check-in) is the
  // one source that's never stale; falls back to guestName/guestPhone for an ordinary
  // single-room booking, where there never was a separate booker to begin with.
  const bookerName = first.bookedByName ?? first.guestName;
  const bookerPhone = first.bookedByPhone ?? first.guestPhone;
  // §user request, reference app's "Booking ID" + "Total Guest": a short, stable, human-readable
  // code derived from the real id (no separate field/migration needed) and the primary guest plus
  // any BookingGuest co-occupants — summed across every room, since each room's own occupant(s)
  // all count toward one reservation's total guest count.
  const bookingIdShort = first.id.slice(-6).toUpperCase();
  const totalGuests = bookings.reduce((sum, b) => sum + 1 + (b.guests?.length ?? 0), 0);
  const addRoomCandidates = rooms.filter((r) => r.status === 'available' && !bookings.some((b) => b.assignedRoomId === r.id));
  const newRoomCategoryId = rooms.find((r) => r.id === newRoomId)?.roomCategoryId;
  const ratePlansForNewRoom = ratePlans.filter((rp) => rp.roomCategoryId === newRoomCategoryId);

  function roomFor(booking: Booking) {
    return rooms.find((r) => r.id === booking.assignedRoomId);
  }

  async function reassignRoom(booking: Booking, roomId: string) {
    await mutate('bookings.reassignReservationRoom', { bookingId: booking.id, roomId }, token ?? undefined);
    onChanged();
  }

  async function removeRoom(booking: Booking) {
    if (!confirm(`Remove Room ${roomFor(booking)?.roomNumber ?? ''} from this reservation? This cancels just that room's booking.`)) return;
    try {
      await mutate('bookings.cancelBooking', { bookingId: booking.id }, token ?? undefined);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to remove room');
    }
  }

  async function addCharge(booking: Booking, description: string, quantity: number, unitPrice: number) {
    await mutate('bookings.addLineItem', { bookingId: booking.id, description, quantity, unitPrice }, token ?? undefined);
    onChanged();
  }

  async function removeCharge(lineItemId: string) {
    await mutate('bookings.removeLineItem', { lineItemId }, token ?? undefined);
    onChanged();
  }

  async function addRoom() {
    if (!newRoomId || !first.reservationGroupId) return;
    setAddRoomSaving(true);
    setAddRoomError(null);
    try {
      await mutate(
        'bookings.addRoomToReservation',
        { reservationGroupId: first.reservationGroupId, roomId: newRoomId, ratePlanId: newRatePlanId || undefined, totalAmount: newAmount },
        token ?? undefined,
      );
      setAddingRoom(false);
      setNewRoomId('');
      setNewRatePlanId('');
      setNewAmount(0);
      onChanged();
    } catch (err) {
      setAddRoomError(err instanceof ApiError ? err.message : 'Failed to add room');
    } finally {
      setAddRoomSaving(false);
    }
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
              {firstPending.checkIn.slice(0, 10) > today ? (
                <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2.5 dark:bg-slate-900">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Check-in opens {formatDateShort(firstPending.checkIn)}</span>
                  <button
                    type="button"
                    onClick={() => setCheckingInBooking(firstPending)}
                    className="text-xs font-medium text-slate-500 hover:text-brand-600 hover:underline dark:text-slate-400 dark:hover:text-brand-400"
                  >
                    Check in early
                  </button>
                </div>
              ) : (
                <Button type="button" className="w-full" onClick={() => setCheckingInBooking(firstPending)}>
                  Start Check-in
                </Button>
              )}
            </div>
          )}

          <div className="px-5 py-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Rooms ({bookings.length})</p>
            <div className="space-y-2">
              {bookings.map((b) => (
                <RoomRow
                  key={b.id}
                  booking={b}
                  room={roomFor(b)}
                  today={today}
                  canManage={canManage}
                  candidateRooms={rooms.filter((r) => r.roomCategoryId === b.roomCategoryId && r.status === 'available' && r.id !== b.assignedRoomId)}
                  onCheckIn={() => setCheckingInBooking(b)}
                  onAddPayment={() => setPayingBooking(b)}
                  onReassignRoom={(roomId) => reassignRoom(b, roomId)}
                  onRemoveRoom={() => removeRoom(b)}
                  onAddCharge={(description, quantity, unitPrice) => addCharge(b, description, quantity, unitPrice)}
                  onRemoveCharge={removeCharge}
                  onPrintInvoice={() => setPrintingBooking(b)}
                />
              ))}
            </div>

            {/* §user request, reference app's "+ Add Room" — only a group reservation
                (Neeraj ji's multi-room booking) has anything to add a room *to*; an ordinary
                single-room reservation has no reservationGroupId to attach a new one against. */}
            {first.reservationGroupId && (
              <div className="mt-2">
                {!addingRoom ? (
                  <button
                    onClick={() => setAddingRoom(true)}
                    className="w-full rounded-xl border border-dashed border-slate-300 py-2.5 text-xs font-medium text-slate-500 hover:border-brand-400 hover:text-brand-600 dark:border-slate-600 dark:text-slate-400 dark:hover:border-brand-500 dark:hover:text-brand-400"
                  >
                    + Add Room
                  </button>
                ) : (
                  <div className="space-y-2 rounded-xl border border-slate-200 p-3.5 dark:border-slate-700">
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        className={`${inputClass} text-xs`}
                        value={newRoomId}
                        onChange={(e) => {
                          setNewRoomId(e.target.value);
                          setNewRatePlanId('');
                        }}
                      >
                        <option value="">— pick a room —</option>
                        {addRoomCandidates.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.roomNumber} — {r.roomCategory?.name ?? 'Uncategorized'}
                          </option>
                        ))}
                      </select>
                      <select className={`${inputClass} text-xs`} value={newRatePlanId} onChange={(e) => setNewRatePlanId(e.target.value)} disabled={!newRoomId}>
                        <option value="">— rate plan (optional) —</option>
                        {ratePlansForNewRoom.map((rp) => (
                          <option key={rp.id} value={rp.id}>
                            {rp.mealPlan ? `${rp.name} (${rp.mealPlan})` : rp.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500 dark:text-slate-400">Total amount</span>
                      <input
                        type="number"
                        min={0}
                        className={`${inputClass} w-28 text-xs`}
                        value={newAmount}
                        onChange={(e) => setNewAmount(Number(e.target.value))}
                      />
                      <div className="ml-auto flex gap-2">
                        <button
                          onClick={() => {
                            setAddingRoom(false);
                            setAddRoomError(null);
                          }}
                          className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                        >
                          Cancel
                        </button>
                        <Button variant="secondary" className="px-2.5 py-1 text-xs" disabled={!newRoomId || addRoomSaving} onClick={addRoom}>
                          {addRoomSaving ? 'Adding…' : 'Add'}
                        </Button>
                      </div>
                    </div>
                    {addRoomError && <p className="text-xs text-red-600">{addRoomError}</p>}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="divide-y divide-slate-100 border-t border-slate-100 px-5 dark:divide-slate-700 dark:border-slate-700">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 py-3 text-sm">
              <div>
                <p className="text-xs text-slate-400 dark:text-slate-500">Booking ID</p>
                <p className="font-medium text-slate-900 dark:text-white">{bookingIdShort}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400 dark:text-slate-500">Total Guests</p>
                <p className="font-medium text-slate-900 dark:text-white">{totalGuests}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400 dark:text-slate-500">Guest Name</p>
                <p className="font-medium text-slate-900 dark:text-white">{bookerName}</p>
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
                <p className="font-medium text-slate-900 dark:text-white">{bookerPhone ?? 'N/A'}</p>
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
            {/* §user request — "Neeraj ji room-wise payment nahi karte, ek hi baar poori booking
                ki karte hain": one payment action against the whole booking's due — the server
                splits it across rooms by their own outstanding, so staff never has to decide
                which room gets how much. */}
            {due > 0 && (
              <Button
                type="button"
                className="mt-1 w-full justify-center"
                onClick={() => (first.reservationGroupId ? setPayingGroup(true) : setPayingBooking(first))}
              >
                Add Payment
              </Button>
            )}
          </div>

          {/* §user request — "payment ka date aur time proper aana chahiye, pata chale 1st
              installment, 2nd, final payment kab hui": every payment collected against this
              booking, oldest first, each its own dated receipt line instead of one rolled-up
              "Paid" total. */}
          <div className="border-t border-slate-100 px-5 py-4 dark:border-slate-700">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Payment History</p>
            <PaymentHistory entries={paymentTimeline} />
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
      {payingGroup && first.reservationGroupId && (
        <GroupPaymentModal
          reservationGroupId={first.reservationGroupId}
          bookerName={bookerName}
          due={due}
          onClose={() => setPayingGroup(false)}
          onDone={onChanged}
        />
      )}
      {printingBooking && (
        <InvoicePrintView
          booking={printingBooking}
          roomType={roomFor(printingBooking)?.roomCategory?.name ?? '—'}
          onClose={() => setPrintingBooking(null)}
        />
      )}
    </>
  );
}
