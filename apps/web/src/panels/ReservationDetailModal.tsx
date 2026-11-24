import { useState } from 'react';
import { mutate, ApiError } from '../api';
import { useAuth } from '../AuthContext';
import { Badge, Button, inputClass } from '../components/ui';
import { computeInvoiceTotals } from '../invoice';
import { formatDateShort, formatDateTimeShort } from '../dateFormat';
import { istDateKey } from '../components/DateRangePicker';
import { ChannelIcon } from './channel-manager/ChannelBadge';
import { SOURCE_LABEL } from './channel-manager/ota-labels';
import { CheckInModal } from './checkin/CheckInModal';
import { PaymentHistory, type PaymentHistoryEntry } from './PaymentHistory';
import { InvoicePrintView } from './InvoicePrintView';
import { RoomTransferPanel } from './RoomTransferPanel';
import type { MoreActionsView } from './MoreActionsPanel';
import type { Booking, Room, RatePlan } from '../types';

const STATUS_LABEL: Record<Booking['status'], string> = {
  confirmed: 'Upcoming',
  checked_in: 'Checked In',
  checked_out: 'Checked Out',
  cancelled: 'Cancelled',
  no_show: 'No Show',
  void: 'Voided',
};

function groupStatus(bookings: Booking[]): Booking['status'] | 'partial' {
  const statuses = new Set(bookings.map((b) => b.status));
  if (statuses.size === 1) return bookings[0].status;
  if ([...statuses].every((s) => s === 'checked_in' || s === 'confirmed')) return 'partial';
  return bookings[0].status;
}

/** "23 Nov 2026" — matches the reference page's own header date style, distinct from this app's
 * usual DD/MM/YY (formatDateShort). */
function formatDateLong(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0][0]}${parts[1][0]}`.toUpperCase() : name.slice(0, 2).toUpperCase();
}

/** One room's own row inside the Rooms table — its own status, own rate, own "⋮" menu for the
 * same per-room actions the old card-style view had inline (change room, remove room, add charge,
 * print invoice) plus its own Check-in, now tucked behind a menu so the row stays a single
 * compact line matching the reference table. */
function RoomTableRow({
  booking,
  room,
  ratePlans,
  today,
  canManage,
  checked,
  onToggleChecked,
  onCheckIn,
  onOpenRoomTransfer,
  onRemoveRoom,
  onAddCharge,
  onRemoveCharge,
  onPrintInvoice,
}: {
  booking: Booking;
  room: Room | undefined;
  ratePlans: RatePlan[];
  today: string;
  canManage: boolean;
  checked: boolean;
  onToggleChecked: () => void;
  onCheckIn: () => void;
  onOpenRoomTransfer: () => void;
  onRemoveRoom: () => void;
  onAddCharge: (description: string, quantity: number, unitPrice: number) => Promise<void>;
  onRemoveCharge: (lineItemId: string) => Promise<void>;
  onPrintInvoice: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [mode, setMode] = useState<'none' | 'charge'>('none');
  const [chargeDesc, setChargeDesc] = useState('');
  const [chargeQty, setChargeQty] = useState(1);
  const [chargeUnitPrice, setChargeUnitPrice] = useState(0);
  const [chargeSaving, setChargeSaving] = useState(false);
  const [chargeError, setChargeError] = useState<string | null>(null);

  const totals = computeInvoiceTotals({
    totalAmount: Number(booking.totalAmount),
    lineItems: booking.lineItems ?? [],
    discountAmount: booking.discountAmount ? Number(booking.discountAmount) : null,
    gstExempt: booking.gstExempt,
  });
  const due = Math.max(0, totals.grandTotal - Number(booking.paidAmount ?? 0));
  const isFutureStay = booking.status === 'confirmed' && booking.checkIn.slice(0, 10) > today;
  const guestCount = 1 + (booking.guests?.length ?? 0);
  const ratePlan = ratePlans.find((rp) => rp.id === booking.ratePlanId);
  const mealPlanLabel = ratePlan?.mealPlan ?? ratePlan?.name ?? '—';

  async function confirmAddCharge() {
    if (!chargeDesc.trim()) return;
    setChargeSaving(true);
    setChargeError(null);
    try {
      await onAddCharge(chargeDesc.trim(), chargeQty, chargeUnitPrice);
      setMode('none');
      setChargeDesc('');
      setChargeQty(1);
      setChargeUnitPrice(0);
    } catch (err) {
      setChargeError(err instanceof ApiError ? err.message : 'Failed to add charge');
    } finally {
      setChargeSaving(false);
    }
  }

  return (
    <div className="border-b border-slate-100 py-3 last:border-0 dark:border-slate-700/60">
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={checked}
          disabled={booking.status !== 'confirmed'}
          onChange={onToggleChecked}
          className="h-4 w-4 shrink-0 rounded border-slate-300 text-brand-600 focus:ring-brand-500 disabled:opacity-30 dark:border-slate-600"
        />
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-base dark:bg-slate-700">🛏️</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-slate-900 dark:text-white">
            {room?.roomNumber ?? '—'} {booking.isVip && <span title="VIP">👑</span>}
          </p>
          <p className="truncate text-xs text-slate-400 dark:text-slate-500">{room?.roomCategory?.name ?? '—'}</p>
        </div>
        <div className="hidden w-28 shrink-0 text-xs text-slate-500 dark:text-slate-400 sm:block">
          {guestCount} Guest{guestCount > 1 ? 's' : ''}
        </div>
        <div className="hidden w-36 shrink-0 text-xs text-slate-500 dark:text-slate-400 md:block">
          {formatDateShort(booking.checkIn)} – {formatDateShort(booking.checkOut)}
          <br />
          <span className="text-slate-400 dark:text-slate-500">{booking.nights} Night{booking.nights > 1 ? 's' : ''}</span>
        </div>
        <div className="hidden w-28 shrink-0 truncate text-xs text-slate-500 dark:text-slate-400 lg:block">{mealPlanLabel}</div>
        <div className="w-24 shrink-0 sm:w-28">
          <Badge tone={booking.status}>{STATUS_LABEL[booking.status]}</Badge>
        </div>
        <div className="hidden w-24 shrink-0 text-right text-xs sm:block">
          <p className="text-slate-400 dark:text-slate-500">Net Charge</p>
          <p className="font-semibold text-slate-900 dark:text-white">₹{totals.grandTotal.toFixed(0)}</p>
        </div>
        <div className="hidden w-24 shrink-0 text-right text-xs sm:block">
          <p className="text-slate-400 dark:text-slate-500">Due</p>
          <p className={`font-semibold ${due > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>₹{due.toFixed(0)}</p>
        </div>
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
            aria-label="Room actions"
          >
            ⋮
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-800">
                {booking.status === 'confirmed' && (
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      onCheckIn();
                    }}
                    className="block w-full rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700/50"
                  >
                    {isFutureStay ? 'Check in early' : 'Check in'}
                  </button>
                )}
                {(booking.status === 'confirmed' || booking.status === 'checked_in') && (
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      onOpenRoomTransfer();
                    }}
                    className="block w-full rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700/50"
                  >
                    Room Transfer
                  </button>
                )}
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    setMode('charge');
                  }}
                  className="block w-full rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700/50"
                >
                  + Add charge
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    onPrintInvoice();
                  }}
                  className="block w-full rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700/50"
                >
                  🧾 Print Invoice
                </button>
                {canManage && booking.reservationGroupId && booking.status === 'confirmed' && (
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      onRemoveRoom();
                    }}
                    className="block w-full rounded-lg px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
                  >
                    Remove room
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {(booking.lineItems?.length ?? 0) > 0 && (
        <div className="ml-12 mt-2 space-y-1">
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

      {mode === 'charge' && (
        <div className="ml-12 mt-2 flex flex-wrap items-center gap-2">
          <input className={`${inputClass} w-32 text-xs`} placeholder="e.g. Extra bedding" value={chargeDesc} onChange={(e) => setChargeDesc(e.target.value)} autoFocus />
          <input type="number" min={1} className={`${inputClass} w-14 text-xs`} value={chargeQty} onChange={(e) => setChargeQty(Math.max(1, Number(e.target.value)))} title="Quantity" />
          <input type="number" min={0} className={`${inputClass} w-20 text-xs`} value={chargeUnitPrice} onChange={(e) => setChargeUnitPrice(Number(e.target.value))} title="Price" />
          <Button variant="secondary" className="px-2.5 py-1 text-xs" disabled={!chargeDesc.trim() || chargeSaving} onClick={confirmAddCharge}>
            {chargeSaving ? 'Adding…' : 'Add'}
          </Button>
          <button onClick={() => setMode('none')} className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
            Cancel
          </button>
          {chargeError && <p className="w-full text-xs text-red-600">{chargeError}</p>}
        </div>
      )}
    </div>
  );
}

/**
 * §user request, with a reference app's full-page Booking Details screen as the explicit visual
 * target (replacing the old centred "Booking Details" popup) — "Maharaj ji ki booking ek hi naam
 * se hai, par alag rooms mein alag guest check-in honge": a proper per-room table (own guest
 * count/dates/meal plan/status/⋮ menu each) under one shared booker/guest summary, with the
 * sticky bottom "Check In" button opening the exact same CheckInModal slider already used
 * everywhere else in the app — nothing new built for that part, just reached from here too.
 */
export function ReservationDetailModal({
  hotelId,
  bookings,
  rooms,
  ratePlans,
  onClose,
  onChanged,
  onMoreActions,
  onEdit,
}: {
  hotelId: string;
  bookings: Booking[];
  rooms: Room[];
  ratePlans: RatePlan[];
  onClose: () => void;
  onChanged: () => void;
  /** Opens the existing MoreActionsPanel for this whole reservation — optionally straight to one
   * of its sub-views (used by the Guest ID / Special Requests shortcuts below). */
  onMoreActions: (initialView?: MoreActionsView) => void;
  /** Opens CreateReservationModal in its existing edit-group mode for this reservation. */
  onEdit: () => void;
}) {
  const { token, role } = useAuth();
  const [tab, setTab] = useState<'overview' | 'folio'>('overview');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [checkInQueue, setCheckInQueue] = useState<Booking[]>([]);
  const [printingBooking, setPrintingBooking] = useState<Booking | null>(null);
  const [transferringBooking, setTransferringBooking] = useState<Booking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addingRoom, setAddingRoom] = useState(false);
  const [newRoomId, setNewRoomId] = useState('');
  const [newRatePlanId, setNewRatePlanId] = useState('');
  const [newAmount, setNewAmount] = useState(0);
  const [addRoomSaving, setAddRoomSaving] = useState(false);
  const [addRoomError, setAddRoomError] = useState<string | null>(null);
  // §user request — "+ icon jisme extra mattress vagera add karne ka option aaye, same jaise
  // reservation banate waqt hota hai": a new room doesn't exist yet to attach a real
  // InvoiceLineItem to, so these stay a local draft list until "Add" actually creates the
  // booking — then each one is persisted via addLineItem, same mechanism CreateReservationModal's
  // own per-room add-on charges use.
  const [newRoomLineItems, setNewRoomLineItems] = useState<{ key: string; description: string; quantity: number; amount: number }[]>([]);
  const [addingNewRoomCharge, setAddingNewRoomCharge] = useState(false);
  const [newChargeDesc, setNewChargeDesc] = useState('');
  const [newChargeQty, setNewChargeQty] = useState<number | ''>(1);
  const [newChargeUnitPrice, setNewChargeUnitPrice] = useState<number | ''>('');
  const canManage = ['owner', 'manager'].includes(role('pms') ?? '') || ['owner', 'manager'].includes(role('channel_manager') ?? '');

  const first = bookings[0];
  const status = groupStatus(bookings);
  const today = istDateKey(new Date().toISOString());

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
  const paymentStatusLabel = due <= 0 ? 'Paid' : paid > 0 ? 'Partially Paid' : 'Unpaid';
  const paymentStatusTone = due <= 0 ? 'text-emerald-600 dark:text-emerald-400' : paid > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400';

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
          merged.set(key, { key, amount: Number(p.amount), collectedAt: p.collectedAt, method: p.method, referenceNumber: p.referenceNumber, rooms: new Set([roomNumber]) });
        }
      }
    }
    return [...merged.values()].map((e) => ({ ...e, roomLabel: e.rooms.size > 1 ? `Rooms ${[...e.rooms].join(', ')}` : undefined }));
  })();

  const bookerName = first.bookedByName ?? first.guestName;
  const bookerPhone = first.bookedByPhone ?? first.guestPhone;
  const bookingIdShort = first.id.slice(-6).toUpperCase();
  const totalGuests = bookings.reduce((sum, b) => sum + 1 + (b.guests?.length ?? 0), 0);
  const addRoomCandidates = rooms.filter((r) => r.status === 'available' && !bookings.some((b) => b.assignedRoomId === r.id));
  const newRoomCategoryId = rooms.find((r) => r.id === newRoomId)?.roomCategoryId;
  const ratePlansForNewRoom = ratePlans.filter((rp) => rp.roomCategoryId === newRoomCategoryId);

  function roomFor(booking: Booking) {
    return rooms.find((r) => r.id === booking.assignedRoomId);
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

  function addNewRoomCharge() {
    if (!newChargeDesc.trim() || newChargeUnitPrice === '') return;
    setNewRoomLineItems((prev) => [
      ...prev,
      { key: `${Date.now()}`, description: newChargeDesc.trim(), quantity: newChargeQty === '' ? 1 : newChargeQty, amount: newChargeUnitPrice * (newChargeQty === '' ? 1 : newChargeQty) },
    ]);
    setAddingNewRoomCharge(false);
    setNewChargeDesc('');
    setNewChargeQty(1);
    setNewChargeUnitPrice('');
  }

  function removeNewRoomCharge(key: string) {
    setNewRoomLineItems((prev) => prev.filter((li) => li.key !== key));
  }

  async function addRoom() {
    if (!newRoomId || !first.reservationGroupId) return;
    setAddRoomSaving(true);
    setAddRoomError(null);
    try {
      const created = await mutate<Booking>(
        'bookings.addRoomToReservation',
        { reservationGroupId: first.reservationGroupId, roomId: newRoomId, ratePlanId: newRatePlanId || undefined, totalAmount: newAmount },
        token ?? undefined,
      );
      await Promise.all(
        newRoomLineItems.map((li) =>
          mutate('bookings.addLineItem', { bookingId: created.id, description: li.description, quantity: li.quantity, unitPrice: li.amount / li.quantity }, token ?? undefined),
        ),
      );
      setAddingRoom(false);
      setNewRoomId('');
      setNewRatePlanId('');
      setNewAmount(0);
      setNewRoomLineItems([]);
      onChanged();
    } catch (err) {
      setAddRoomError(err instanceof ApiError ? err.message : 'Failed to add room');
    } finally {
      setAddRoomSaving(false);
    }
  }

  function toggleSelected(bookingId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(bookingId)) next.delete(bookingId);
      else next.add(bookingId);
      return next;
    });
  }

  // §user request — "jo check-in pe click karenge toh wahi slider khulega jo humne banaya hai":
  // every trigger below (per-room ⋮ menu, this bottom bar) feeds the exact same CheckInModal,
  // just queued one booking at a time so a multi-room "Check In" still walks through each room's
  // own guest details in turn instead of needing a brand-new bulk wizard.
  const eligibleToday = bookings.filter((b) => b.status === 'confirmed' && b.checkIn.slice(0, 10) <= today);
  const eligibleFuture = bookings.filter((b) => b.status === 'confirmed' && b.checkIn.slice(0, 10) > today);

  function targetsFor(pool: Booking[]) {
    const picked = pool.filter((b) => selected.has(b.id));
    return picked.length > 0 ? picked : pool;
  }

  function startCheckIn(pool: Booking[]) {
    if (pool.length === 0) return;
    setCheckInQueue(pool);
  }

  const currentCheckIn = checkInQueue[0] ?? null;

  const allConfirmedSelected = bookings.filter((b) => b.status === 'confirmed').length > 0 && bookings.filter((b) => b.status === 'confirmed').every((b) => selected.has(b.id));

  function toggleSelectAll() {
    const confirmedIds = bookings.filter((b) => b.status === 'confirmed').map((b) => b.id);
    setSelected(allConfirmedSelected ? new Set() : new Set(confirmedIds));
  }

  return (
    <>
      <div className="fixed inset-0 z-50 flex flex-col bg-slate-50 dark:bg-slate-900">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-4 py-4 dark:border-slate-700 dark:bg-slate-800 sm:px-6">
          <div className="flex items-start gap-3">
            <button onClick={onClose} className="mt-1 shrink-0 text-xl text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white" aria-label="Back">
              ←
            </button>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-lg font-bold text-slate-900 dark:text-white sm:text-xl">Booking #{bookingIdShort}</h1>
                <Badge tone={status === 'partial' ? 'checked_in' : status}>{status === 'partial' ? 'Partially Checked In' : STATUS_LABEL[status]}</Badge>
              </div>
              <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500 sm:text-sm">Created on {formatDateLong(first.createdAt)}</p>
            </div>
          </div>
          <Button type="button" variant="secondary" onClick={() => onMoreActions()} className="shrink-0">
            More Actions
          </Button>
        </div>

        {error && <p className="px-4 pt-3 text-sm text-red-600 dark:text-red-400 sm:px-6">{error}</p>}

        <div className="flex-1 overflow-y-auto">
          <div className="p-4 sm:p-6">
            <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-2xl bg-brand-50 px-5 py-4 dark:bg-brand-500/10">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">{initialsOf(bookerName)}</span>
                <div>
                  <p className="flex items-center gap-1.5 text-sm font-bold text-slate-900 dark:text-white">
                    {bookerName} {first.isVip && <span title="VIP">👑</span>}
                  </p>
                  {bookerPhone && <p className="text-xs text-slate-500 dark:text-slate-400">📞 {bookerPhone}</p>}
                </div>
              </div>
              <div>
                <p className="text-xs text-slate-400 dark:text-slate-500">📅 Stay Period</p>
                <p className="text-sm font-medium text-slate-900 dark:text-white">
                  {formatDateTimeShort(first.checkIn)} – {formatDateTimeShort(first.checkOut)}
                </p>
                <p className="text-xs text-slate-400 dark:text-slate-500">({first.nights} Night{first.nights > 1 ? 's' : ''})</p>
              </div>
              <div>
                <p className="text-xs text-slate-400 dark:text-slate-500">🛏 Rooms</p>
                <p className="text-sm font-bold text-slate-900 dark:text-white">{bookings.length} Room{bookings.length > 1 ? 's' : ''}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400 dark:text-slate-500">👤 Guests</p>
                <p className="text-sm font-bold text-slate-900 dark:text-white">{totalGuests} Guest{totalGuests > 1 ? 's' : ''}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400 dark:text-slate-500">🌐 Booking Source</p>
                <p className="flex items-center gap-1.5 text-sm font-bold text-slate-900 dark:text-white">
                  <ChannelIcon source={first.source} className="h-4 w-4" /> {SOURCE_LABEL[first.source] ?? first.source}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-400 dark:text-slate-500">⏱ Payment Status</p>
                <p className={`text-sm font-bold ${paymentStatusTone}`}>{paymentStatusLabel}</p>
              </div>
              <span className="ml-auto hidden text-4xl opacity-80 lg:inline">🏨</span>
            </div>

            <div className="mt-4 flex gap-2 border-b border-slate-200 dark:border-slate-700">
              <button
                onClick={() => setTab('overview')}
                className={`rounded-t-lg px-4 py-2 text-sm font-semibold ${
                  tab === 'overview' ? 'border-b-2 border-brand-600 text-brand-600 dark:text-brand-400' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
                }`}
              >
                Overview
              </button>
              <button
                onClick={() => setTab('folio')}
                className={`rounded-t-lg px-4 py-2 text-sm font-semibold ${
                  tab === 'folio' ? 'border-b-2 border-brand-600 text-brand-600 dark:text-brand-400' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
                }`}
              >
                Master Folio
              </button>
            </div>

            {tab === 'overview' ? (
              <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
                <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800 sm:p-5">
                  <div className="flex items-center gap-3">
                    <input type="checkbox" checked={allConfirmedSelected} onChange={toggleSelectAll} className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 dark:border-slate-600" />
                    <h2 className="text-sm font-bold text-slate-900 dark:text-white">Rooms ({String(bookings.length).padStart(2, '0')})</h2>
                  </div>
                  <p className="mb-1 ml-7 text-xs text-slate-400 dark:text-slate-500">Each room can have different guests, rates and status.</p>

                  <div className="mt-2">
                    {bookings.map((b) => (
                      <RoomTableRow
                        key={b.id}
                        booking={b}
                        room={roomFor(b)}
                        ratePlans={ratePlans}
                        today={today}
                        canManage={canManage}
                        checked={selected.has(b.id)}
                        onToggleChecked={() => toggleSelected(b.id)}
                        onCheckIn={() => startCheckIn([b])}
                        onOpenRoomTransfer={() => setTransferringBooking(b)}
                        onRemoveRoom={() => removeRoom(b)}
                        onAddCharge={(description, quantity, unitPrice) => addCharge(b, description, quantity, unitPrice)}
                        onRemoveCharge={removeCharge}
                        onPrintInvoice={() => setPrintingBooking(b)}
                      />
                    ))}
                  </div>

                  {first.reservationGroupId && (
                    <div className="mt-3">
                      {!addingRoom ? (
                        <button
                          onClick={() => setAddingRoom(true)}
                          className="w-full rounded-xl border border-dashed border-slate-300 py-2.5 text-xs font-medium text-slate-500 hover:border-brand-400 hover:text-brand-600 dark:border-slate-600 dark:text-slate-400 dark:hover:border-brand-500 dark:hover:text-brand-400"
                        >
                          + Add Room
                        </button>
                      ) : (
                        // §user request, with CreateReservationModal's own Rooms Selection row as the
                        // explicit target — room dropdown, a pill-style Meal Plan select, a Base
                        // Price pill-input, and the same "+" add-on button (extra mattress etc.) next
                        // to it, so adding a room to an already-created reservation looks and works
                        // exactly like picking one while creating it.
                        <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                            <div className="flex min-w-0 flex-1 items-center gap-3">
                              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-base shadow-sm dark:bg-slate-800">🛏️</span>
                              <select
                                className={`${inputClass} w-full`}
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
                            </div>

                            <div className="flex flex-wrap shrink-0 items-end gap-2.5">
                              <div className="w-32">
                                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Meal Plan</p>
                                <select
                                  className="w-full truncate rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-600 outline-none disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300"
                                  value={newRatePlanId}
                                  onChange={(e) => setNewRatePlanId(e.target.value)}
                                  disabled={!newRoomId}
                                >
                                  <option value="">— none —</option>
                                  {ratePlansForNewRoom.map((rp) => (
                                    <option key={rp.id} value={rp.id}>
                                      {rp.mealPlan ? `${rp.name} (${rp.mealPlan})` : rp.name}
                                    </option>
                                  ))}
                                </select>
                              </div>

                              <div className="w-28">
                                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Total amount</p>
                                <div className="relative">
                                  <input
                                    type="number"
                                    min={0}
                                    className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-2.5 pr-6 text-sm font-semibold text-slate-900 outline-none focus:border-brand-400 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                                    value={newAmount}
                                    onChange={(e) => setNewAmount(Number(e.target.value))}
                                  />
                                  <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-300 dark:text-slate-600">✎</span>
                                </div>
                              </div>

                              <button
                                type="button"
                                onClick={() => setAddingNewRoomCharge((o) => !o)}
                                title="Add-on / extra charge"
                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-base font-bold text-brand-600 hover:border-brand-400 hover:bg-brand-50/40 dark:border-slate-600 dark:text-brand-400 dark:hover:bg-brand-500/10"
                              >
                                +
                              </button>
                            </div>
                          </div>

                          {newRoomLineItems.length > 0 && (
                            <div className="mt-2.5 space-y-1.5 sm:pl-[52px]">
                              {newRoomLineItems.map((li) => (
                                <div key={li.key} className="flex items-center justify-between rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs dark:bg-slate-900/40">
                                  <span className="text-slate-600 dark:text-slate-300">
                                    {li.description} {li.quantity > 1 ? `× ${li.quantity}` : ''}
                                  </span>
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium text-slate-700 dark:text-slate-200">₹{li.amount.toFixed(2)}</span>
                                    <button type="button" onClick={() => removeNewRoomCharge(li.key)} className="text-red-500 hover:underline">
                                      Remove
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          {addingNewRoomCharge && (
                            <div className="mt-2.5 flex flex-wrap items-center gap-2 sm:pl-[52px]">
                              <input
                                className="min-w-[160px] flex-1 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm italic text-slate-900 outline-none placeholder:text-slate-400 focus:border-brand-400 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                                placeholder="Eg.   Extra Mattress"
                                value={newChargeDesc}
                                onChange={(e) => setNewChargeDesc(e.target.value)}
                                autoFocus
                              />
                              <div className="flex shrink-0 items-center gap-3 rounded-full border border-slate-200 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800">
                                <button
                                  type="button"
                                  onClick={() => setNewChargeQty((q) => Math.max(1, (q === '' ? 1 : q) - 1))}
                                  className="text-lg font-bold leading-none text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                                >
                                  −
                                </button>
                                <span className="text-sm font-semibold text-slate-900 dark:text-white">{newChargeQty === '' ? 1 : newChargeQty}</span>
                                <button
                                  type="button"
                                  onClick={() => setNewChargeQty((q) => (q === '' ? 1 : q) + 1)}
                                  className="text-lg font-bold leading-none text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                                >
                                  +
                                </button>
                              </div>
                              <input
                                className="w-28 shrink-0 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm italic text-slate-900 outline-none placeholder:text-slate-400 focus:border-brand-400 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                                type="number"
                                placeholder="Price"
                                min={0}
                                value={newChargeUnitPrice}
                                onChange={(e) => setNewChargeUnitPrice(e.target.value === '' ? '' : Number(e.target.value))}
                              />
                              <button
                                type="button"
                                onClick={addNewRoomCharge}
                                title="Add charge"
                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 text-lg font-bold text-brand-600 hover:border-brand-400 hover:bg-brand-50/40 dark:border-slate-600 dark:text-brand-400 dark:hover:bg-brand-500/10"
                              >
                                +
                              </button>
                              <button
                                type="button"
                                onClick={() => setAddingNewRoomCharge(false)}
                                title="Cancel"
                                className="flex h-9 w-9 shrink-0 items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                              >
                                ✕
                              </button>
                            </div>
                          )}

                          <div className="mt-3 flex items-center justify-end gap-2">
                            <button
                              onClick={() => {
                                setAddingRoom(false);
                                setAddRoomError(null);
                                setNewRoomLineItems([]);
                              }}
                              className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                            >
                              Cancel
                            </button>
                            <Button variant="secondary" className="px-2.5 py-1 text-xs" disabled={!newRoomId || addRoomSaving} onClick={addRoom}>
                              {addRoomSaving ? 'Adding…' : 'Add'}
                            </Button>
                          </div>
                          {addRoomError && <p className="mt-1.5 text-right text-xs text-red-600">{addRoomError}</p>}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="space-y-4">
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div>
                        <p className="text-xs text-slate-400 dark:text-slate-500">Total Charges</p>
                        <p className="mt-0.5 text-sm font-bold text-slate-900 dark:text-white">₹{grandTotal.toFixed(0)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-400 dark:text-slate-500">Advance</p>
                        <p className="mt-0.5 text-sm font-bold text-emerald-600 dark:text-emerald-400">₹{paid.toFixed(0)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-400 dark:text-slate-500">Due</p>
                        <p className={`mt-0.5 text-sm font-bold ${due > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>₹{due.toFixed(0)}</p>
                      </div>
                    </div>
                    {due > 0 && (
                      <Button type="button" className="mt-3 w-full justify-center" onClick={() => onMoreActions('payment')}>
                        Record Payment
                      </Button>
                    )}
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white">Guest Information</h3>
                      <button onClick={onEdit} className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">
                        Edit
                      </button>
                    </div>
                    <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">{bookerName}</p>
                    <span className="mt-1 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 dark:bg-slate-700 dark:text-slate-300">Primary Guest</span>
                    {bookerPhone && <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">📞 {bookerPhone}</p>}
                    {first.guestEmail && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">✉️ {first.guestEmail}</p>}
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white p-4 text-center dark:border-slate-700 dark:bg-slate-800">
                    <div className="flex items-center justify-between text-left">
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white">Guest ID</h3>
                      <button onClick={() => onMoreActions('identity')} className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">
                        {first.idPhotoFrontPath ? 'View / Edit' : '+ Scan Document'}
                      </button>
                    </div>
                    {first.idPhotoFrontPath ? (
                      <div className="mt-3 text-left text-sm">
                        <p className="font-semibold text-slate-900 dark:text-white">{first.idType?.replace(/_/g, ' ') ?? 'ID'}</p>
                        <p className="text-slate-500 dark:text-slate-400">{first.idNumber ?? '—'}</p>
                      </div>
                    ) : (
                      <>
                        <p className="mt-3 text-3xl">🪪</p>
                        <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">No Document Scanned</p>
                        <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                          Upload or capture the primary guest's ID to automatically extract name, ID number, date of birth, address.
                        </p>
                      </>
                    )}
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white p-4 text-center dark:border-slate-700 dark:bg-slate-800">
                    <div className="flex items-center justify-between text-left">
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white">Special Requests</h3>
                      <button onClick={() => onMoreActions('special')} className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">
                        {first.specialRequest ? 'Edit' : '+ Add Request'}
                      </button>
                    </div>
                    {first.specialRequest ? (
                      <p className="mt-3 text-left text-sm text-slate-700 dark:text-slate-300">{first.specialRequest}</p>
                    ) : (
                      <>
                        <p className="mt-3 text-3xl">📋</p>
                        <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">No Special Requests</p>
                        <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Add guest preferences such as early check-in, late checkout, high floor.</p>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
                <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
                  <div>
                    <p className="text-xs text-slate-400 dark:text-slate-500">Booking ID</p>
                    <p className="font-medium text-slate-900 dark:text-white">{bookingIdShort}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400 dark:text-slate-500">Total Guests</p>
                    <p className="font-medium text-slate-900 dark:text-white">{totalGuests}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400 dark:text-slate-500">Booking Date</p>
                    <p className="font-medium text-slate-900 dark:text-white">{formatDateTimeShort(first.createdAt)}</p>
                  </div>
                </div>

                <div className="mt-5 space-y-1.5 border-t border-slate-100 pt-4 text-sm dark:border-slate-700">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Per-room charges</p>
                  {bookings.map((b) => {
                    const totals = computeInvoiceTotals({
                      totalAmount: Number(b.totalAmount),
                      lineItems: b.lineItems ?? [],
                      discountAmount: b.discountAmount ? Number(b.discountAmount) : null,
                      gstExempt: b.gstExempt,
                    });
                    return (
                      <div key={b.id} className="flex justify-between text-slate-500 dark:text-slate-400">
                        <span>Room {roomFor(b)?.roomNumber ?? '—'}</span>
                        <span className="text-slate-900 dark:text-white">₹{totals.grandTotal.toFixed(2)}</span>
                      </div>
                    );
                  })}
                  <div className="flex justify-between border-t border-slate-100 pt-1.5 font-medium text-slate-500 dark:border-slate-700 dark:text-slate-400">
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
                    <Button type="button" className="mt-1 w-full justify-center" onClick={() => onMoreActions('payment')}>
                      Record Payment
                    </Button>
                  )}
                </div>

                <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-700">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Payment History</p>
                  <PaymentHistory entries={paymentTimeline} />
                </div>
              </div>
            )}
          </div>
        </div>

        {(eligibleToday.length > 0 || eligibleFuture.length > 0) && (
          <div className="flex items-center justify-end gap-3 border-t border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-800 sm:px-6">
            {eligibleFuture.length > 0 && (
              <Button type="button" variant="secondary" onClick={() => startCheckIn(targetsFor(eligibleFuture))}>
                Pre-check-in
              </Button>
            )}
            {eligibleToday.length > 0 && (
              <Button type="button" onClick={() => startCheckIn(targetsFor(eligibleToday))}>
                Check In
              </Button>
            )}
          </div>
        )}
      </div>

      {currentCheckIn && (
        <CheckInModal
          hotelId={hotelId}
          reservation={currentCheckIn}
          assignedRoomNumber={roomFor(currentCheckIn)?.roomNumber}
          onClose={() => setCheckInQueue([])}
          onDone={() => {
            setCheckInQueue((q) => q.slice(1));
            onChanged();
          }}
        />
      )}
      {printingBooking && (
        <InvoicePrintView booking={printingBooking} roomType={roomFor(printingBooking)?.roomCategory?.name ?? '—'} onClose={() => setPrintingBooking(null)} />
      )}
      {transferringBooking && (
        <RoomTransferPanel
          hotelId={hotelId}
          booking={transferringBooking}
          rooms={rooms}
          onClose={() => setTransferringBooking(null)}
          onChanged={onChanged}
        />
      )}
    </>
  );
}
