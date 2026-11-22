import { useState } from 'react';
import { createPortal } from 'react-dom';
import { mutate, uploadFile, ApiError } from '../api';
import { useAuth } from '../AuthContext';
import { Button, Field, inputClass } from '../components/ui';
import { computeInvoiceTotals } from '../invoice';
import { formatDateShort } from '../dateFormat';
import { paymentMethodLabel } from '../paymentMethods';
import { AddPaymentModal } from './AddPaymentModal';
import { AdvanceReceiptPrintView } from './checkin/AdvanceReceiptPrintView';
import { BookingVoucherPrintView } from './checkin/BookingVoucherPrintView';
import type { ReservationSuccessData } from './checkin/ReservationSuccessModal';
import type { Booking, IdType, PaymentMethod, RatePlan, Room, RoomCategory } from '../types';

type View = 'menu' | 'cancel' | 'noshow' | 'void' | 'special' | 'vip' | 'notes' | 'payment' | 'times' | 'identity' | 'receipts' | 'mealplan';

const ID_TYPE_OPTIONS: IdType[] = ['aadhaar', 'passport', 'driving_license', 'voter_id', 'other'];

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
  const payments = group.flatMap((b) =>
    (b.payments ?? []).map((p) => ({ method: p.method as PaymentMethod, amount: Number(p.amount), referenceNumber: p.referenceNumber ?? undefined })),
  );

  return {
    hotelId,
    bookingCode: `BK-${lead.id.slice(-6).toUpperCase()}`,
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
 * action it lists, either wired to a real backend field/endpoint (Cancel/No Show/Void/Special
 * Request/VIP/Internal Notes/Record Payment/Expected Times/Identity Verification/Meal Plan — all
 * new, added specifically for this menu) or reusing one this app already had (Record Payment →
 * the existing AddPaymentModal, Receipt Management → the Advance Receipt/Booking Voucher
 * CreateReservationModal's own success popup already prints, rebuilt here from the stored booking
 * instead of fresh creation-time state).
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
  const [view, setView] = useState<View>('menu');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [specialRequest, setSpecialRequest] = useState(lead.specialRequest ?? '');
  const [notes, setNotes] = useState(lead.internalNotes ?? '');
  const [arrivalTime, setArrivalTime] = useState(lead.expectedArrivalTime ?? '');
  const [departureTime, setDepartureTime] = useState(lead.expectedDepartureTime ?? '');
  const [idType, setIdType] = useState<IdType | ''>(lead.idType ?? '');
  const [idNumber, setIdNumber] = useState(lead.idNumber ?? '');
  const [frontPath, setFrontPath] = useState(lead.idPhotoFrontPath ?? '');
  const [backPath, setBackPath] = useState(lead.idPhotoBackPath ?? '');
  const [uploadingSide, setUploadingSide] = useState<'front' | 'back' | null>(null);
  const [mealPlans, setMealPlans] = useState<Record<string, string>>(() => Object.fromEntries(group.map((b) => [b.id, b.ratePlanId ?? ''])));
  const [payingBooking, setPayingBooking] = useState<Booking | null>(null);
  const [printing, setPrinting] = useState<'receipt' | 'voucher' | null>(null);

  const canEnd = group.some((b) => b.status === 'confirmed');

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
    await run(() => mutate('bookings.endReservationGroup', { bookingId: lead.id, status }, token ?? undefined), onClose);
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

  const MENU_ITEMS: { view: View; icon: string; label: string; disabled?: boolean }[] = [
    { view: 'cancel', icon: '✕', label: 'Cancel entire reservation', disabled: !canEnd },
    { view: 'noshow', icon: '✉️', label: 'Mark as No Show', disabled: !canEnd },
    { view: 'void', icon: '✉️', label: 'Void Reservation', disabled: !canEnd },
    { view: 'special', icon: '📋', label: 'Add special request' },
    { view: 'vip', icon: '👑', label: 'Mark as VIP' },
    { view: 'notes', icon: '📝', label: 'Add internal notes' },
    { view: 'payment', icon: '💰', label: 'Record Payment' },
    { view: 'times', icon: '🕐', label: 'Update Expected Times' },
    { view: 'identity', icon: '🪪', label: 'Identity Verification' },
    { view: 'receipts', icon: '🧾', label: 'Receipt Management' },
    { view: 'mealplan', icon: '🍽️', label: 'Change meal plan' },
  ];

  return createPortal(
    // §bugfix — AddPaymentModal (z-[60]) and the print views (z-[80]) both render as siblings in
    // this same portal, so this panel itself must sit BELOW z-60 or it would stack on top of and
    // hide the payment form behind its own backdrop — z-50 matches ReservationDetailModal's own
    // "major modal" layer, same reasoning as that modal's own z-50/AddPaymentModal z-60 pairing.
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40">
      <div className="flex h-full w-full max-w-md flex-col overflow-hidden bg-white shadow-2xl dark:bg-slate-800">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-700">
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">{view === 'menu' ? 'More Actions' : MENU_ITEMS.find((m) => m.view === view)?.label}</h3>
            <p className="text-xs text-slate-400 dark:text-slate-500">{view === 'menu' ? 'Edit, communicate, print, payments and more' : lead.guestName}</p>
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

        <div className="flex-1 overflow-y-auto">
          {error && <p className="mx-5 mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

          {view === 'menu' && (
            <div className="divide-y divide-slate-100 dark:divide-slate-700">
              {MENU_ITEMS.map((item) => (
                <button
                  key={item.view}
                  type="button"
                  disabled={item.disabled}
                  onClick={() => (item.view === 'payment' ? setPayingBooking(lead) : setView(item.view))}
                  className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-slate-700/50"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-base dark:bg-brand-500/10">{item.icon}</span>
                  <span className="flex-1 text-sm font-semibold text-slate-900 dark:text-white">{item.label}</span>
                  <span className="text-slate-300 dark:text-slate-600">›</span>
                </button>
              ))}
            </div>
          )}

          {(view === 'cancel' || view === 'noshow' || view === 'void') && (
            <div className="space-y-4 p-5">
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {view === 'cancel' && 'This cancels every confirmed room in this reservation. This cannot be undone.'}
                {view === 'noshow' && 'Marks every confirmed room in this reservation as a no-show. This cannot be undone.'}
                {view === 'void' && 'Voids every confirmed room in this reservation, as if it were never made. This cannot be undone.'}
              </p>
              <Button
                type="button"
                variant="danger"
                disabled={busy}
                onClick={() => endGroup(view === 'cancel' ? 'cancelled' : view === 'noshow' ? 'no_show' : 'void')}
                className="w-full"
              >
                {busy ? 'Working…' : view === 'cancel' ? 'Cancel entire reservation' : view === 'noshow' ? 'Mark as No Show' : 'Void Reservation'}
              </Button>
            </div>
          )}

          {view === 'special' && (
            <div className="space-y-3 p-5">
              <Field label="Special request">
                <textarea className={`${inputClass} min-h-24`} value={specialRequest} onChange={(e) => setSpecialRequest(e.target.value)} placeholder="e.g. Late check-in, extra pillows" />
              </Field>
              <Button type="button" disabled={busy} onClick={() => run(() => mutate('bookings.updateSpecialRequest', { bookingId: lead.id, specialRequest: specialRequest.trim() || null }, token ?? undefined))} className="w-full">
                {busy ? 'Saving…' : 'Save'}
              </Button>
            </div>
          )}

          {view === 'vip' && (
            <div className="space-y-4 p-5">
              <label className="flex items-center justify-between rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                <span className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">👑 VIP guest</span>
                <input
                  type="checkbox"
                  className="h-5 w-5 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                  defaultChecked={lead.isVip}
                  onChange={(e) => run(() => mutate('bookings.setVip', { bookingId: lead.id, isVip: e.target.checked }, token ?? undefined), () => {})}
                />
              </label>
            </div>
          )}

          {view === 'notes' && (
            <div className="space-y-3 p-5">
              <Field label="Internal notes (staff only, not shown to the guest)">
                <textarea className={`${inputClass} min-h-24`} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Repeat guest, prefers higher floor" />
              </Field>
              <Button type="button" disabled={busy} onClick={() => run(() => mutate('bookings.updateInternalNotes', { bookingId: lead.id, internalNotes: notes.trim() || null }, token ?? undefined))} className="w-full">
                {busy ? 'Saving…' : 'Save'}
              </Button>
            </div>
          )}

          {view === 'times' && (
            <div className="space-y-3 p-5">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Expected arrival">
                  <input className={inputClass} type="time" value={arrivalTime} onChange={(e) => setArrivalTime(e.target.value)} />
                </Field>
                <Field label="Expected departure">
                  <input className={inputClass} type="time" value={departureTime} onChange={(e) => setDepartureTime(e.target.value)} />
                </Field>
              </div>
              <Button
                type="button"
                disabled={busy}
                onClick={() =>
                  run(() =>
                    mutate(
                      'bookings.updateExpectedTimes',
                      { bookingId: lead.id, expectedArrivalTime: arrivalTime || null, expectedDepartureTime: departureTime || null },
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

          {view === 'identity' && (
            <div className="space-y-3 p-5">
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
            <div className="space-y-4 p-5">
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
                {group.flatMap((b) => b.payments ?? []).length === 0 ? (
                  <p className="text-sm text-slate-400 dark:text-slate-500">No payments recorded yet.</p>
                ) : (
                  <div className="space-y-1.5">
                    {group
                      .flatMap((b) => b.payments ?? [])
                      .map((p) => (
                        <div key={p.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-900/40">
                          <span className="text-slate-600 dark:text-slate-300">
                            {formatDateShort(p.collectedAt)} · {paymentMethodLabel(p.method)}
                          </span>
                          <span className="font-semibold text-slate-900 dark:text-white">₹{Number(p.amount).toFixed(2)}</span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {view === 'mealplan' && (
            <div className="space-y-4 p-5">
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

      {payingBooking && <AddPaymentModal booking={payingBooking} onClose={() => setPayingBooking(null)} onDone={onChanged} />}
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
