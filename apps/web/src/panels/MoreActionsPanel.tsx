import { useState } from 'react';
import { createPortal } from 'react-dom';
import { mutate, uploadFile, ApiError } from '../api';
import { useAuth } from '../AuthContext';
import { Button, Combobox, Field, inputClass } from '../components/ui';
import { computeInvoiceTotals } from '../invoice';
import { formatDateShort } from '../dateFormat';
import { PAYMENT_METHODS, paymentMethodLabel } from '../paymentMethods';
import { AdvanceReceiptPrintView } from './checkin/AdvanceReceiptPrintView';
import { BookingVoucherPrintView } from './checkin/BookingVoucherPrintView';
import type { ReservationSuccessData } from './checkin/ReservationSuccessModal';
import type { Booking, IdType, Payment, PaymentMethod, PaymentType, RatePlan, Room, RoomCategory } from '../types';

type View = 'menu' | 'cancel' | 'noshow' | 'void' | 'special' | 'vip' | 'payment' | 'identity' | 'receipts' | 'mealplan';

const ID_TYPE_OPTIONS: IdType[] = ['aadhaar', 'passport', 'driving_license', 'voter_id', 'other'];
const PAYMENT_TYPE_OPTIONS: { value: PaymentType; label: string; description: string }[] = [
  { value: 'advance', label: 'Advance Payment', description: 'An upfront payment before the stay' },
  { value: 'partial', label: 'Part Payment', description: 'A partial payment against the outstanding balance' },
  { value: 'full', label: 'Full Payment', description: 'Settles the outstanding balance in full' },
];

function bookingCode(id: string) {
  return `BK-${id.slice(-6).toUpperCase()}`;
}

/** "Nov 24, 2026" — the Cancel confirmation's own date style, distinct from this app's usual
 * DD/MM/YY (formatDateShort) since that reads badly next to prose like "Are you sure…". */
function formatDateLong(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/**
 * §user request — "itni saari payments kyun dikh rahi hain, sirf 2 baar payment hui hai": one
 * advance/Record-Payment collection is stored as several Payment rows under the hood — one per
 * room it got prorated across, occasionally per mode too — so the real ledger can track each
 * room's own revenue. Shown straight to an FMO/guest, though, that reads as a dozen tiny random
 * amounts instead of the two payments that actually happened. The backend now stamps every row
 * from the same collection event with the exact same collectedAt, so grouping by that timestamp
 * reconstructs the real logical transactions — summing amounts and combining modes/references
 * back into one row per event, oldest first.
 */
function collapsePayments(raw: Payment[]): { modeLabel: string; amount: number; referenceNumber?: string; collectedAt: string }[] {
  const groups = new Map<string, { modes: Set<string>; amount: number; refs: Set<string>; collectedAt: string }>();
  for (const p of raw) {
    const key = p.collectedAt;
    const existing = groups.get(key);
    const modeLabel = paymentMethodLabel(p.method);
    if (existing) {
      existing.amount += Number(p.amount);
      existing.modes.add(modeLabel);
      if (p.referenceNumber) existing.refs.add(p.referenceNumber);
    } else {
      groups.set(key, { modes: new Set([modeLabel]), amount: Number(p.amount), refs: new Set(p.referenceNumber ? [p.referenceNumber] : []), collectedAt: key });
    }
  }
  return [...groups.values()]
    .sort((a, b) => a.collectedAt.localeCompare(b.collectedAt))
    .map((g) => ({ modeLabel: [...g.modes].join(' + '), amount: g.amount, referenceNumber: [...g.refs].join(', ') || undefined, collectedAt: g.collectedAt }));
}

/** Pre-builds a ReservationSuccessData-shaped object from a STORED reservation (any age), the
 * way CreateReservationModal's own success popup builds one fresh right after creating one —
 * reused here so Receipt Management can reprint the exact same two documents for an existing
 * booking, not just a brand-new one. */
function buildReceiptData(hotelId: string, group: Booking[], roomsById: Map<string, Room>, categories: RoomCategory[], ratePlans: RatePlan[]): ReservationSuccessData {
  const lead = group[0];
  let baseTotal = 0;
  let extraCharges = 0;
  let discount = 0;
  let gstAmount = 0;
  let gstLabel = '0%';
  let grandTotal = 0;
  const rooms = group.map((b) => {
    const totals = computeInvoiceTotals({
      totalAmount: Number(b.totalAmount),
      lineItems: b.lineItems ?? [],
      discountAmount: b.discountAmount ? Number(b.discountAmount) : null,
      gstExempt: b.gstExempt,
    });
    baseTotal += totals.basePrice;
    extraCharges += totals.extraCharges;
    discount += totals.discount;
    gstAmount += totals.gst.amount;
    gstLabel = totals.gst.label;
    grandTotal += totals.grandTotal;
    const room = roomsById.get(b.assignedRoomId ?? '');
    return {
      roomNumber: room?.roomNumber ?? '—',
      categoryName: room?.roomCategory?.name ?? categories.find((c) => c.id === b.roomCategoryId)?.name ?? '—',
      ratePlanName: ratePlans.find((rp) => rp.id === b.ratePlanId)?.name,
      ratePerNight: b.nights > 0 ? totals.basePrice / b.nights : totals.basePrice,
      nights: b.nights,
      total: totals.basePrice,
    };
  });
  const paid = group.reduce((sum, b) => sum + Number(b.paidAmount ?? 0), 0);
  const due = Math.max(0, grandTotal - paid);
  const payments = collapsePayments(group.flatMap((b) => b.payments ?? []));

  return {
    hotelId,
    bookingCode: bookingCode(lead.id),
    createdAt: lead.createdAt,
    guestName: lead.guestName,
    guestPhone: lead.guestPhone ?? undefined,
    companyName: lead.billToCompanyName ?? undefined,
    companyGstin: lead.billToCompanyGstin ?? undefined,
    checkIn: lead.checkIn,
    checkOut: lead.checkOut,
    nights: lead.nights,
    rooms,
    extraCharges,
    discount,
    gstAmount,
    gstLabel,
    grandTotal,
    advanceAmount: paid,
    due,
    payments,
  };
}

/**
 * §user request, with a reference app's own "More Actions" slide-over as the target — every
 * action it lists wired to a real backend field/endpoint, or reusing one this app already had
 * (Receipt Management → the Advance Receipt/Booking Voucher CreateReservationModal's own success
 * popup already prints, rebuilt here from the stored booking instead of fresh creation-time
 * state). Internal Notes and Update Expected Times were dropped as their own menu entries per
 * follow-up feedback — internalNotes still backs the VIP reason below, nothing deleted there.
 */
export function MoreActionsPanel({
  hotelId,
  group,
  roomsById,
  categories,
  ratePlans,
  onClose,
  onChanged,
}: {
  hotelId: string;
  group: Booking[];
  roomsById: Map<string, Room>;
  categories: RoomCategory[];
  ratePlans: RatePlan[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const { token } = useAuth();
  const lead = group[0];

  // Per-room + group outstanding, used by the Cancel confirmation's total and the Record
  // Payment view's Outstanding box/scope switch.
  const dues = new Map<string, number>();
  let groupGrandTotal = 0;
  let groupDue = 0;
  let groupPaid = 0;
  for (const b of group) {
    const totals = computeInvoiceTotals({
      totalAmount: Number(b.totalAmount),
      lineItems: b.lineItems ?? [],
      discountAmount: b.discountAmount ? Number(b.discountAmount) : null,
      gstExempt: b.gstExempt,
    });
    const paid = Number(b.paidAmount ?? 0);
    const due = Math.max(0, totals.grandTotal - paid);
    dues.set(b.id, due);
    groupGrandTotal += totals.grandTotal;
    groupDue += due;
    groupPaid += paid;
  }
  const roomSummary = (() => {
    const counts = new Map<string, number>();
    for (const b of group) {
      const name = roomsById.get(b.assignedRoomId ?? '')?.roomCategory?.name ?? categories.find((c) => c.id === b.roomCategoryId)?.name ?? '—';
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts.entries()].map(([name, count]) => `${count} ${name}`).join(' · ');
  })();

  const [view, setView] = useState<View>('menu');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [specialRequest, setSpecialRequest] = useState(lead.specialRequest ?? '');
  const [endReason, setEndReason] = useState('');
  const [cancellationCharge, setCancellationCharge] = useState(0);
  const [vipReason, setVipReason] = useState('');
  const [idType, setIdType] = useState<IdType | ''>(lead.idType ?? '');
  const [idNumber, setIdNumber] = useState(lead.idNumber ?? '');
  const [frontPath, setFrontPath] = useState(lead.idPhotoFrontPath ?? '');
  const [backPath, setBackPath] = useState(lead.idPhotoBackPath ?? '');
  const [uploadingSide, setUploadingSide] = useState<'front' | 'back' | null>(null);
  const [mealPlans, setMealPlans] = useState<Record<string, string>>(() => Object.fromEntries(group.map((b) => [b.id, b.ratePlanId ?? ''])));
  const [printing, setPrinting] = useState<'receipt' | 'voucher' | null>(null);

  const [allocate, setAllocate] = useState<'group' | 'room'>('group');
  const [targetBookingId, setTargetBookingId] = useState(lead.id);
  const [amount, setAmount] = useState(group.length > 1 ? groupDue : (dues.get(lead.id) ?? 0));
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [paymentType, setPaymentType] = useState<PaymentType>('advance');
  const [referenceNumber, setReferenceNumber] = useState('');

  const canEnd = group.some((b) => b.status === 'confirmed');
  const outstandingForScope = allocate === 'group' && group.length > 1 ? groupDue : (dues.get(targetBookingId) ?? 0);

  async function run(action: () => Promise<unknown>, after: () => void = () => setView('menu')) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
      after();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  async function endGroup(status: 'cancelled' | 'no_show' | 'void') {
    await run(
      () => mutate('bookings.endReservationGroup', { bookingId: lead.id, status, reason: endReason.trim() || undefined, cancellationCharge: status === 'cancelled' ? cancellationCharge : undefined }, token ?? undefined),
      onClose,
    );
  }

  async function uploadIdSide(side: 'front' | 'back', file: File) {
    setUploadingSide(side);
    setError(null);
    try {
      const result = await uploadFile<{ filePath: string }>('uploads/booking-id', file, token ?? undefined);
      if (side === 'front') setFrontPath(result.filePath);
      else setBackPath(result.filePath);
    } catch {
      setError('Upload failed');
    } finally {
      setUploadingSide(null);
    }
  }

  async function saveMealPlans() {
    setBusy(true);
    setError(null);
    try {
      const changed = group.filter((b) => (mealPlans[b.id] || '') !== (b.ratePlanId ?? ''));
      await Promise.all(changed.map((b) => mutate('bookings.updateRatePlan', { bookingId: b.id, ratePlanId: mealPlans[b.id] || null }, token ?? undefined)));
      onChanged();
      setView('menu');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update meal plan');
    } finally {
      setBusy(false);
    }
  }

  async function recordPayment() {
    await run(() =>
      allocate === 'group' && group.length > 1 && lead.reservationGroupId
        ? mutate(
            'bookings.addGroupPayment',
            { reservationGroupId: lead.reservationGroupId, amount, method, type: paymentType, referenceNumber: referenceNumber || undefined },
            token ?? undefined,
          )
        : mutate(
            'bookings.addPayment',
            { bookingId: targetBookingId, amount, method, type: paymentType, referenceNumber: referenceNumber || undefined },
            token ?? undefined,
          ),
    );
  }

  const MENU_ITEMS: { view: View; icon: string; label: string; disabled?: boolean }[] = [
    { view: 'cancel', icon: '✕', label: 'Cancel entire reservation', disabled: !canEnd },
    { view: 'noshow', icon: '🧳', label: 'Mark as No Show', disabled: !canEnd },
    { view: 'void', icon: '🚫', label: 'Void Reservation', disabled: !canEnd },
    { view: 'special', icon: '📋', label: 'Add special request' },
    { view: 'vip', icon: '👑', label: lead.isVip ? 'Remove VIP status' : 'Mark as VIP' },
    { view: 'payment', icon: '💰', label: 'Record Payment' },
    { view: 'identity', icon: '🪪', label: 'Identity Verification' },
    { view: 'receipts', icon: '🧾', label: 'Receipt Management' },
    { view: 'mealplan', icon: '🍽️', label: 'Change meal plan' },
  ];

  return createPortal(
    // §bugfix — the print views (z-[80]) render as siblings in this same portal, so this panel
    // must sit below that — z-50 matches ReservationDetailModal's own "major modal" layer.
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40">
      {/* §bugfix — "3 no wala box [No Show/Void] rectangular nahi tha, text/buttons right side se
          cut ho rahe the": flex children default to min-width:auto, so this panel refused to
          shrink below its own content's natural width (the description paragraph) on a narrow
          screen and overflowed past the viewport's right edge instead of wrapping — min-w-0 lets
          it actually shrink to the available space so text wraps inside it instead. */}
      <div className="flex h-full w-full min-w-0 max-w-md flex-col overflow-hidden bg-white shadow-2xl dark:bg-slate-800">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-700">
          <div className="min-w-0">
            <h3 className="truncate text-lg font-bold text-slate-900 dark:text-white">{view === 'menu' ? 'More Actions' : MENU_ITEMS.find((m) => m.view === view)?.label}</h3>
            <p className="truncate text-xs text-slate-400 dark:text-slate-500">{view === 'menu' ? 'Edit, communicate, print, payments and more' : lead.guestName}</p>
          </div>
          <button
            type="button"
            onClick={view === 'menu' ? onClose : () => setView('menu')}
            aria-label={view === 'menu' ? 'Close' : 'Back'}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700"
          >
            {view === 'menu' ? '✕' : '←'}
          </button>
        </div>

        {/* §bugfix — the previous min-w-0 was only on the panel's own flex slot (vs. the
            backdrop); this content area is ITSELF a flex child of the panel's flex-col and hit
            the exact same min-width:auto shrink-refusal independently, still clipping text/
            buttons on the right on a narrow screen. */}
        <div className="min-w-0 flex-1 overflow-y-auto">
          {error && <p className="mx-5 mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

          {view === 'menu' && (
            <div className="divide-y divide-slate-100 dark:divide-slate-700">
              {MENU_ITEMS.map((item) => (
                <button
                  key={item.view}
                  type="button"
                  disabled={item.disabled}
                  onClick={() => setView(item.view)}
                  className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-slate-700/50"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-base dark:bg-brand-500/10">{item.icon}</span>
                  <span className="flex-1 text-sm font-semibold text-slate-900 dark:text-white">{item.label}</span>
                  <span className="text-slate-300 dark:text-slate-600">›</span>
                </button>
              ))}
            </div>
          )}

          {/* §user request, with a reference app's own Confirm Cancellation screen as the target —
              stay dates, booking id, a required reason, and a Total/Charge/Refund breakdown
              instead of a bare confirm button. cancellationCharge/Refund are informational only
              (no real refund transaction fires — same as the rest of this app's cash movements
              staying manual). */}
          {view === 'cancel' && (
            <div className="min-w-0 p-5">
              <p className="mb-4 break-words text-sm text-slate-600 dark:text-slate-300">
                Are you sure you want to cancel this reservation? The status will be updated to 'Cancelled', and all assigned rooms will be released.
              </p>
              <div className="mb-3 grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-4 dark:bg-slate-900/40">
                <div>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500">Check-in</p>
                  <p className="text-sm font-bold text-slate-900 dark:text-white">{formatDateLong(lead.checkIn)}</p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] text-slate-400 dark:text-slate-500">Check-out</p>
                  <p className="text-sm font-bold text-slate-900 dark:text-white">{formatDateLong(lead.checkOut)}</p>
                </div>
              </div>
              <div className="mb-4 flex items-center justify-between rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-700">
                <span className="font-semibold text-slate-900 dark:text-white">Booking ID</span>
                <span className="font-mono font-bold text-brand-600 dark:text-brand-400">Confirmation #: {bookingCode(lead.id)}</span>
              </div>
              <Field label="Reason For Cancellation *">
                <textarea className={`${inputClass} w-full min-h-20 resize-none`} value={endReason} onChange={(e) => setEndReason(e.target.value)} placeholder="Enter reason" />
              </Field>
              {/* §bugfix — "jo guest ne advance amount paid kiya hai vo show hona chahiye, uske
                  neeche se cancellation charges deduct karke denge": a refund can only ever come
                  out of what the guest actually already paid, never the full booking value — so
                  this now shows Advance Paid (not Total) as the figure the charge is subtracted
                  from, with the cancellation charge itself capped at that same paid amount. */}
              <div className="my-4 space-y-2 rounded-xl bg-slate-50 p-4 dark:bg-slate-900/40">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-600 dark:text-slate-300">Total Booking Amount</span>
                  <span className="font-bold text-slate-900 dark:text-white">₹{groupGrandTotal.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-600 dark:text-slate-300">Advance Paid</span>
                  <span className="font-bold text-slate-900 dark:text-white">₹{groupPaid.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-600 dark:text-slate-300">Cancellation Charge</span>
                  <input
                    type="number"
                    min={0}
                    max={groupPaid}
                    className="w-32 rounded-lg border border-slate-200 bg-white px-2 py-1 text-right text-sm font-semibold text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                    value={cancellationCharge}
                    onChange={(e) => setCancellationCharge(Math.max(0, Math.min(groupPaid, Number(e.target.value))))}
                  />
                </div>
                <div className="flex items-center justify-between border-t border-slate-200 pt-2 text-sm dark:border-slate-700">
                  <span className="font-bold text-emerald-600 dark:text-emerald-400">Refund Amount</span>
                  <span className="font-bold text-emerald-600 dark:text-emerald-400">₹{Math.max(0, groupPaid - cancellationCharge).toFixed(2)}</span>
                </div>
              </div>
              <div className="space-y-2">
                <Button type="button" variant="secondary" className="w-full" onClick={() => setView('menu')}>
                  No, Keep Reservation
                </Button>
                <Button type="button" variant="danger" className="w-full" disabled={busy || !endReason.trim()} onClick={() => endGroup('cancelled')}>
                  {busy ? 'Cancelling…' : 'Yes, Cancel Reservation'}
                </Button>
              </div>
            </div>
          )}

          {(view === 'noshow' || view === 'void') && (
            <div className="min-w-0 p-5 text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-50 text-3xl dark:bg-red-500/10">{view === 'noshow' ? '🧳' : '🚫'}</div>
              <h4 className="mb-2 text-base font-bold text-slate-900 dark:text-white">{view === 'noshow' ? 'Mark as No Show' : 'Void Reservation'}</h4>
              <p className="mb-4 break-words text-sm text-slate-500 dark:text-slate-400">
                {view === 'noshow'
                  ? "The guest did not arrive for the scheduled check-in. Marking this reservation as No Show will update the reservation status and release the room based on your property's policy."
                  : 'This voids the reservation entirely, as if it were never made — use this only for a booking created by mistake, not a guest who simply cancelled.'}
              </p>
              {/* §bugfix — "box ko proper rectangular karo": this textarea had no explicit width
                  (inputClass alone doesn't set one, and it wasn't wrapped in Field, whose flex
                  column stretches a bare child to full width) — it was falling back to the
                  browser's own un-styled default size instead of a clean full-width rectangle. */}
              <textarea
                className={`${inputClass} w-full min-h-28 resize-none text-left`}
                value={endReason}
                onChange={(e) => setEndReason(e.target.value)}
                placeholder={view === 'noshow' ? 'Reason (optional)' : 'Reason for voiding (optional)'}
              />
              <div className="mt-4 flex gap-2">
                <Button type="button" variant="secondary" className="flex-1" onClick={() => setView('menu')}>
                  Cancel
                </Button>
                <Button type="button" variant="danger" className="flex-1" disabled={busy} onClick={() => endGroup(view === 'noshow' ? 'no_show' : 'void')}>
                  {busy ? 'Working…' : view === 'noshow' ? 'Mark as No Show' : 'Void Reservation'}
                </Button>
              </div>
            </div>
          )}

          {view === 'special' && (
            <div className="min-w-0 space-y-3 p-5">
              <Field label="Special request">
                <textarea className={`${inputClass} w-full min-h-24 resize-none`} value={specialRequest} onChange={(e) => setSpecialRequest(e.target.value)} placeholder="e.g. Late check-in, extra pillows" />
              </Field>
              <Button type="button" disabled={busy} onClick={() => run(() => mutate('bookings.updateSpecialRequest', { bookingId: lead.id, specialRequest: specialRequest.trim() || null }, token ?? undefined))} className="w-full">
                {busy ? 'Saving…' : 'Save'}
              </Button>
            </div>
          )}

          {/* §user request, with a reference app's own "Mark Room as VIP" confirmation as the
              target — a reason/notes field (stored in internalNotes, since that's no longer its
              own menu entry) instead of a bare toggle; the card itself picks up a golden shine and
              the crown icon once isVip is true (see Bookings.tsx's ReservationCard). */}
          {view === 'vip' && (
            <div className="min-w-0 p-5">
              <p className="mb-4 break-words text-sm text-slate-600 dark:text-slate-300">
                {lead.isVip
                  ? `Remove VIP status from ${roomSummary}? It will no longer be highlighted across the Stay View and related modules.`
                  : `Are you sure you want to mark ${roomSummary} as a VIP room? The room will be highlighted across the Stay View and related modules.`}
              </p>
              {!lead.isVip && (
                <Field label="Reason / Notes">
                  <textarea
                    className={`${inputClass} w-full min-h-24 resize-none`}
                    value={vipReason}
                    onChange={(e) => setVipReason(e.target.value)}
                    placeholder="e.g., Returning guest, Corporate client, Honeymoon guest."
                  />
                </Field>
              )}
              <div className="mt-4 flex gap-2">
                <Button type="button" variant="secondary" className="flex-1" onClick={() => setView('menu')}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  className="flex-1"
                  disabled={busy}
                  onClick={() =>
                    run(() =>
                      mutate('bookings.setVip', { bookingId: lead.id, isVip: !lead.isVip, notes: lead.isVip ? undefined : vipReason.trim() || undefined }, token ?? undefined),
                    )
                  }
                >
                  {busy ? 'Saving…' : lead.isVip ? 'Remove VIP' : 'Mark as VIP'}
                </Button>
              </div>
            </div>
          )}

          {/* §user request, with a reference app's own Record Payment screen as the target —
              Outstanding box, an Entire Reservation/Specific Room allocation choice (only shown
              for an actual multi-room group), and Payment Method/Payment Type as the same
              click-to-open Combobox list this app already uses elsewhere, instead of
              AddPaymentModal's plain pill buttons. */}
          {view === 'payment' && (
            <div className="min-w-0 space-y-4 p-5">
              <div>
                <h4 className="text-base font-bold text-slate-900 dark:text-white">Record payment</h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">Post an interim payment any time during the stay. Amount is editable for part-payments.</p>
              </div>

              <div className="rounded-xl bg-amber-50 p-3 dark:bg-amber-500/10">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-900 dark:text-white">Outstanding</span>
                  <span className="text-lg font-bold text-slate-900 dark:text-white">₹{outstandingForScope.toLocaleString('en-IN')}</span>
                </div>
              </div>

              {group.length > 1 && (
                <div>
                  <p className="mb-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">Allocate Payment</p>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-1.5 text-sm text-slate-700 dark:text-slate-200">
                      <input
                        type="radio"
                        checked={allocate === 'group'}
                        onChange={() => {
                          setAllocate('group');
                          setAmount(groupDue);
                        }}
                        className="h-4 w-4 text-brand-600 focus:ring-brand-500"
                      />
                      Entire Reservation
                    </label>
                    <label className="flex items-center gap-1.5 text-sm text-slate-700 dark:text-slate-200">
                      <input
                        type="radio"
                        checked={allocate === 'room'}
                        onChange={() => {
                          setAllocate('room');
                          setAmount(dues.get(targetBookingId) ?? 0);
                        }}
                        className="h-4 w-4 text-brand-600 focus:ring-brand-500"
                      />
                      Specific Room
                    </label>
                  </div>
                </div>
              )}

              {allocate === 'room' && group.length > 1 && (
                <Field label="Room">
                  <select
                    className={inputClass}
                    value={targetBookingId}
                    onChange={(e) => {
                      setTargetBookingId(e.target.value);
                      setAmount(dues.get(e.target.value) ?? 0);
                    }}
                  >
                    {group.map((b) => {
                      const room = roomsById.get(b.assignedRoomId ?? '');
                      return (
                        <option key={b.id} value={b.id}>
                          Room {room?.roomNumber ?? '—'} · Due ₹{(dues.get(b.id) ?? 0).toFixed(2)}
                        </option>
                      );
                    })}
                  </select>
                </Field>
              )}

              <Field label="Amount to pay">
                <input className={inputClass} type="number" min={1} max={outstandingForScope} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
              </Field>

              <Field label="Payment Method">
                <Combobox value={method} options={PAYMENT_METHODS} onChange={setMethod} />
              </Field>

              <Field label="Payment Type">
                <Combobox
                  value={paymentType}
                  options={PAYMENT_TYPE_OPTIONS}
                  onChange={(t) => {
                    setPaymentType(t);
                    if (t === 'full') setAmount(outstandingForScope);
                  }}
                />
              </Field>

              <Field label="Reference number (optional)">
                <input className={inputClass} value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} />
              </Field>

              <Button type="button" className="w-full" disabled={busy || amount <= 0} onClick={recordPayment}>
                {busy ? 'Recording…' : 'Record Payment'}
              </Button>
            </div>
          )}

          {view === 'identity' && (
            <div className="min-w-0 space-y-3 p-5">
              <div className="grid grid-cols-2 gap-3">
                <Field label="ID type">
                  <select className={inputClass} value={idType} onChange={(e) => setIdType(e.target.value as IdType)}>
                    <option value="">— select —</option>
                    {ID_TYPE_OPTIONS.map((t) => (
                      <option key={t} value={t}>
                        {t.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="ID number">
                  <input className={inputClass} value={idNumber} onChange={(e) => setIdNumber(e.target.value)} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <IdSideUpload label="Front side" path={frontPath} uploading={uploadingSide === 'front'} onPick={(f) => uploadIdSide('front', f)} />
                <IdSideUpload label="Back side (optional)" path={backPath} uploading={uploadingSide === 'back'} onPick={(f) => uploadIdSide('back', f)} />
              </div>
              <Button
                type="button"
                disabled={busy}
                onClick={() =>
                  run(() =>
                    mutate(
                      'bookings.updateIdentityDocs',
                      { bookingId: lead.id, idType: idType || null, idNumber: idNumber.trim() || null, idPhotoFrontPath: frontPath || null, idPhotoBackPath: backPath || null },
                      token ?? undefined,
                    ),
                  )
                }
                className="w-full"
              >
                {busy ? 'Saving…' : 'Save'}
              </Button>
            </div>
          )}

          {view === 'receipts' && (
            <div className="min-w-0 space-y-4 p-5">
              <div className="flex gap-2.5">
                <Button type="button" onClick={() => setPrinting('receipt')} className="flex-1">
                  🧾 Advance Receipt
                </Button>
                <Button type="button" variant="secondary" onClick={() => setPrinting('voucher')} className="flex-1">
                  📋 Booking Voucher
                </Button>
              </div>
              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">Payments recorded</p>
                {(() => {
                  const collected = collapsePayments(group.flatMap((b) => b.payments ?? []));
                  return collected.length === 0 ? (
                    <p className="text-sm text-slate-400 dark:text-slate-500">No payments recorded yet.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {collected.map((p, i) => (
                        <div key={i} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-900/40">
                          <span className="text-slate-600 dark:text-slate-300">
                            {formatDateShort(p.collectedAt)} · {p.modeLabel}
                          </span>
                          <span className="font-semibold text-slate-900 dark:text-white">₹{p.amount.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {view === 'mealplan' && (
            <div className="min-w-0 space-y-4 p-5">
              {group.map((b) => {
                const room = roomsById.get(b.assignedRoomId ?? '');
                const roomRatePlans = ratePlans.filter((rp) => rp.roomCategoryId === b.roomCategoryId);
                return (
                  <Field key={b.id} label={`Room ${room?.roomNumber ?? '—'} · ${room?.roomCategory?.name ?? categories.find((c) => c.id === b.roomCategoryId)?.name ?? '—'}`}>
                    <select className={inputClass} value={mealPlans[b.id] ?? ''} onChange={(e) => setMealPlans((prev) => ({ ...prev, [b.id]: e.target.value }))}>
                      <option value="">— none —</option>
                      {roomRatePlans.map((rp) => (
                        <option key={rp.id} value={rp.id}>
                          {rp.mealPlan ? `${rp.name} (${rp.mealPlan})` : rp.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                );
              })}
              <Button type="button" disabled={busy} onClick={saveMealPlans} className="w-full">
                {busy ? 'Saving…' : 'Save Changes'}
              </Button>
            </div>
          )}
        </div>
      </div>

      {printing === 'receipt' && <AdvanceReceiptPrintView data={buildReceiptData(hotelId, group, roomsById, categories, ratePlans)} onClose={() => setPrinting(null)} />}
      {printing === 'voucher' && <BookingVoucherPrintView data={buildReceiptData(hotelId, group, roomsById, categories, ratePlans)} onClose={() => setPrinting(null)} />}
    </div>,
    document.body,
  );
}

function IdSideUpload({ label, path, uploading, onPick }: { label: string; path: string; uploading: boolean; onPick: (file: File) => void }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">{label}</p>
      <label className="flex h-20 cursor-pointer items-center justify-center rounded-lg border border-dashed border-slate-300 text-xs text-slate-400 hover:border-brand-400 dark:border-slate-600">
        {uploading ? 'Uploading…' : path ? '✓ Uploaded — tap to replace' : 'Tap to upload'}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onPick(file);
          }}
        />
      </label>
    </div>
  );
}
