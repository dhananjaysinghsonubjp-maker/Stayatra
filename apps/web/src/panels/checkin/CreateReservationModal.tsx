import { useEffect, useState } from 'react';
import { mutate, query, ApiError } from '../../api';
import { useAuth } from '../../AuthContext';
import { Button, Card, Field, inputClass } from '../../components/ui';
import { formatDateShort } from '../../dateFormat';
import { computeGstSlab } from '../../gst';
import { computeInvoiceTotals } from '../../invoice';
import { paymentMethodLabel } from '../../paymentMethods';
import { RoomPickerModal } from './RoomPickerModal';
import type { Booking, PaymentMethod, RatePlan, Room } from '../../types';

type GstMode = 'exclusive' | 'inclusive' | 'exempt';
type DiscountType = 'flat' | 'percent';

interface DraftLineItem {
  key: string;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

function todayPlus(days: number) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

const SOURCE_OPTIONS: { value: string; label: string }[] = [
  { value: 'direct', label: 'Direct' },
  { value: 'walk_in', label: 'Walk-in' },
  { value: 'booking_com', label: 'Booking.com' },
  { value: 'mmt_goibibo', label: 'MakeMyTrip / Goibibo' },
  { value: 'agoda', label: 'Agoda' },
  { value: 'airbnb', label: 'Airbnb' },
  { value: 'expedia', label: 'Expedia' },
  { value: 'cleartrip', label: 'Cleartrip' },
  { value: 'easemytrip', label: 'EaseMyTrip' },
  { value: 'yatra', label: 'Yatra' },
];
const METHOD_OPTIONS: PaymentMethod[] = ['cash', 'upi', 'online', 'card', 'bank_transfer', 'cheque', 'credit_sale', 'company_settlement', 'agent_settlement', 'cash_deposit'];

interface PickedRoom {
  room: Room;
  ratePerNight: number;
  ratePlanId: string;
  lineItems: DraftLineItem[];
  // §user request, with a reference app's own per-room date chip as the target — a bulk/wedding
  // reservation's rooms don't always share the same stay. Undefined = inherits the reservation's
  // own check-in/check-out below.
  checkIn?: string;
  checkOut?: string;
}

/**
 * §user request, with a reference app's own multi-step Create Reservation flow as the explicit
 * target — Reservation Details → specific room picker (not just a category) → per-room pricing
 * → an advance payment, split across the rooms it's recorded against. Every room becomes its
 * own Booking row sharing one reservationGroupId (§bookings.service.ts createMultiRoomReservation)
 * so each can later be checked in independently ("partial check-in" is just that, nothing more).
 */
export function CreateReservationModal({
  hotelId,
  onClose,
  onDone,
  editGroup,
}: {
  hotelId: string;
  onClose: () => void;
  onDone: () => void;
  /** §user request, with a reference app's own calendar-bar "Edit reservation" as the target —
   * every Booking row sharing one reservationGroupId, prefilling this same form instead of a
   * blank one and saving via bookings.updateReservationGroup instead of create. */
  editGroup?: Booking[];
}) {
  const { token } = useAuth();
  const isEditMode = Boolean(editGroup && editGroup.length > 0);
  const [source, setSource] = useState('direct');
  const [checkIn, setCheckIn] = useState(todayPlus(0));
  const [checkOut, setCheckOut] = useState(todayPlus(1));
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [specialRequest, setSpecialRequest] = useState('');

  const [picked, setPicked] = useState<PickedRoom[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [availableRooms, setAvailableRooms] = useState<(Room & { available: boolean })[]>([]);
  const [draftSelectedIds, setDraftSelectedIds] = useState<string[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [ratePlans, setRatePlans] = useState<RatePlan[]>([]);

  // §user request — "+ add-on" extra charges per room (extra mattress and other add-ons),
  // same InvoiceLineItem mechanism check-in's own "+ Add Extra Charges" already uses — only one
  // room's add-on form is open at a time, tracked by room id.
  const [addingChargeFor, setAddingChargeFor] = useState<string | null>(null);
  const [editingDatesFor, setEditingDatesFor] = useState<string | null>(null);
  const [chargeDesc, setChargeDesc] = useState('');
  const [chargeQty, setChargeQty] = useState<number | ''>('');
  const [chargeUnitPrice, setChargeUnitPrice] = useState<number | ''>('');

  useEffect(() => {
    query<RatePlan[]>('rates.listAllRatePlansForHotel', { hotelId }, token ?? undefined).then(setRatePlans);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId]);

  // §user request — "jaise check-in create karte hai usme discount aur GST ka option rehta hai
  // vese hi reservation vale me daalo": same GST mode (exclusive/inclusive/exempt) + discount
  // (flat/%) controls as CheckInModal's InvoiceStep, applied across the whole reservation and
  // split per room on submit — each room keeps its own totalAmount/discountAmount/gstExempt,
  // same fields checkInWalkIn already uses, nothing new on the data model.
  const [gstMode, setGstMode] = useState<GstMode>('exclusive');
  const [discountEnabled, setDiscountEnabled] = useState(false);
  const [discountType, setDiscountType] = useState<DiscountType>('flat');
  const [discountAmount, setDiscountAmountValue] = useState<number | ''>('');
  const [discountPercent, setDiscountPercent] = useState(10);

  const [advanceAmount, setAdvanceAmount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('upi');

  // §user request — "corporate booking vala nahi dala hai", then "poora company details daalne
  // ka option" with a reference app's own Individual/Company toggle as the target: picking
  // Company reveals this full set (Tax ID type + number, company contact, address) instead of
  // just name/GSTIN/address, and bills the whole reservation to it — same billToCompany* fields
  // the invoice view's own "Bill to company" already writes later, just set from the start.
  const [guestType, setGuestType] = useState<'individual' | 'company'>('individual');
  const isCorporate = guestType === 'company';
  const [companyName, setCompanyName] = useState('');
  const [companyTaxIdType, setCompanyTaxIdType] = useState('GSTIN');
  const [companyGstin, setCompanyGstin] = useState('');
  const [companyPhone, setCompanyPhone] = useState('');
  const [companyEmail, setCompanyEmail] = useState('');
  const [companyAddress, setCompanyAddress] = useState('');
  const [companyCountry, setCompanyCountry] = useState('India');
  const [companyState, setCompanyState] = useState('');
  const [companyCity, setCompanyCity] = useState('');
  const [companyPincode, setCompanyPincode] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // §user request, with a reference app's own calendar-bar "Edit reservation" as the target —
  // fills this same form from an existing group's bookings instead of starting blank. Each
  // Booking row only carries its own assignedRoomId, not a full Room object, so the matching
  // Room (for its category name, used throughout the room card below) is fetched once here.
  useEffect(() => {
    if (!editGroup || editGroup.length === 0) return;
    (async () => {
      const allRooms = await query<Room[]>('hotels.listRooms', { hotelId }, token ?? undefined);
      const first = editGroup[0];
      const isGroup = editGroup.length > 1;
      const minCheckIn = editGroup.reduce((min, b) => (b.checkIn < min ? b.checkIn : min), first.checkIn).slice(0, 10);
      const maxCheckOut = editGroup.reduce((max, b) => (b.checkOut > max ? b.checkOut : max), first.checkOut).slice(0, 10);
      setSource(first.source);
      setCheckIn(minCheckIn);
      setCheckOut(maxCheckOut);
      setGuestName(isGroup && first.bookedByName ? first.bookedByName : first.guestName);
      setGuestPhone((isGroup && first.bookedByPhone ? first.bookedByPhone : first.guestPhone) ?? '');
      setGuestEmail(first.guestEmail ?? '');
      setSpecialRequest(first.specialRequest ?? '');
      setGstMode(editGroup.every((b) => b.gstExempt) ? 'exempt' : 'exclusive');
      if (first.billToCompanyName) {
        setGuestType('company');
        setCompanyName(first.billToCompanyName);
        setCompanyTaxIdType(first.billToCompanyTaxIdType ?? 'GSTIN');
        setCompanyGstin(first.billToCompanyGstin ?? '');
        setCompanyPhone(first.billToCompanyPhone ?? '');
        setCompanyEmail(first.billToCompanyEmail ?? '');
        setCompanyAddress(first.billToCompanyAddress ?? '');
        setCompanyCountry(first.billToCompanyCountry ?? 'India');
        setCompanyState(first.billToCompanyState ?? '');
        setCompanyCity(first.billToCompanyCity ?? '');
        setCompanyPincode(first.billToCompanyPincode ?? '');
      }
      const newPicked: PickedRoom[] = editGroup
        .filter((b) => b.assignedRoomId && allRooms.some((r) => r.id === b.assignedRoomId))
        .map((b) => {
          const room = allRooms.find((r) => r.id === b.assignedRoomId)!;
          const bCheckIn = b.checkIn.slice(0, 10);
          const bCheckOut = b.checkOut.slice(0, 10);
          return {
            room,
            ratePerNight: Math.round((Number(b.totalAmount) / Math.max(1, b.nights)) * 100) / 100,
            ratePlanId: b.ratePlanId ?? '',
            lineItems: (b.lineItems ?? []).map((li) => ({
              key: crypto.randomUUID(),
              description: li.description,
              quantity: li.quantity,
              unitPrice: Number(li.unitPrice),
              amount: Number(li.amount),
            })),
            checkIn: bCheckIn !== minCheckIn ? bCheckIn : undefined,
            checkOut: bCheckOut !== maxCheckOut ? bCheckOut : undefined,
          };
        });
      setPicked(newPicked);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editGroup]);

  const nights = Math.max(1, Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86400000));

  function roomNights(p: Pick<PickedRoom, 'checkIn' | 'checkOut'>) {
    const ci = p.checkIn || checkIn;
    const co = p.checkOut || checkOut;
    return Math.max(1, Math.round((new Date(co).getTime() - new Date(ci).getTime()) / 86400000));
  }

  // "Inclusive" means each room's entered charge already has GST baked in — back out that
  // room's own pre-tax base (its own GST slab may differ room to room by price) before any
  // other total is computed, same as InvoiceStep does for a single room. Add-on charges are
  // never backed out — same as InvoiceStep, they sit on top of the room rate as-is.
  const roomsWithBase = picked.map((p) => {
    const roomStayNights = roomNights(p);
    const totalAmount = p.ratePerNight * roomStayNights;
    const rate = computeGstSlab(totalAmount).rate;
    const base = gstMode === 'inclusive' ? Math.round((totalAmount / (1 + rate / 100)) * 100) / 100 : totalAmount;
    const extraChargesSum = p.lineItems.reduce((sum, li) => sum + li.amount, 0);
    return { ...p, totalAmount, base, extraChargesSum, roomStayNights };
  });
  const baseTotal = roomsWithBase.reduce((sum, p) => sum + p.base, 0);
  const extraChargesTotal = roomsWithBase.reduce((sum, p) => sum + p.extraChargesSum, 0);
  const discountBase = baseTotal + extraChargesTotal;
  const effectiveDiscountAmount = discountEnabled
    ? discountType === 'percent'
      ? Math.round(((discountPercent / 100) * discountBase + Number.EPSILON) * 100) / 100
      : Number(discountAmount) || 0
    : 0;
  const allLineItems = roomsWithBase.flatMap((p) => p.lineItems);
  const totals = computeInvoiceTotals({ totalAmount: baseTotal, lineItems: allLineItems, discountAmount: effectiveDiscountAmount || null, gstExempt: gstMode === 'exempt' });
  const grandTotal = totals.grandTotal;
  // Edit mode never records a new payment through this form (that stays Add Payment's job) —
  // "due" here reflects what's already been paid against the group instead of a fresh advance.
  const alreadyPaid = isEditMode ? (editGroup ?? []).reduce((sum, b) => sum + Number(b.paidAmount ?? 0), 0) : 0;
  const due = Math.max(0, grandTotal - (isEditMode ? alreadyPaid : advanceAmount));

  async function openPicker() {
    setError(null);
    setLoadingRooms(true);
    try {
      const rooms = await query<(Room & { available: boolean })[]>(
        'bookings.listRoomsWithAvailability',
        { hotelId, checkIn, checkOut },
        token ?? undefined,
      );
      setAvailableRooms(rooms);
      setDraftSelectedIds(picked.map((p) => p.room.id));
      setPickerOpen(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load rooms');
    } finally {
      setLoadingRooms(false);
    }
  }

  function confirmPicker() {
    const newlyPicked: PickedRoom[] = draftSelectedIds.map((id) => {
      const existing = picked.find((p) => p.room.id === id);
      if (existing) return existing;
      const room = availableRooms.find((r) => r.id === id)!;
      return { room, ratePerNight: 0, ratePlanId: '', lineItems: [] };
    });
    setPicked(newlyPicked);
    setPickerOpen(false);
  }

  function removeRoom(roomId: string) {
    setPicked((prev) => prev.filter((p) => p.room.id !== roomId));
  }

  function updateRatePlan(roomId: string, ratePlanId: string) {
    setPicked((prev) => prev.map((p) => (p.room.id === roomId ? { ...p, ratePlanId } : p)));
  }

  function addCharge(e: React.FormEvent, roomId: string) {
    e.preventDefault();
    const quantity = Number(chargeQty) || 1;
    const unitPrice = Number(chargeUnitPrice) || 0;
    setPicked((prev) =>
      prev.map((p) =>
        p.room.id === roomId
          ? { ...p, lineItems: [...p.lineItems, { key: crypto.randomUUID(), description: chargeDesc, quantity, unitPrice, amount: quantity * unitPrice }] }
          : p,
      ),
    );
    setChargeDesc('');
    setChargeQty('');
    setChargeUnitPrice('');
    setAddingChargeFor(null);
  }

  function removeCharge(roomId: string, key: string) {
    setPicked((prev) => prev.map((p) => (p.room.id === roomId ? { ...p, lineItems: p.lineItems.filter((li) => li.key !== key) } : p)));
  }

  function updateRate(roomId: string, rate: number) {
    setPicked((prev) => prev.map((p) => (p.room.id === roomId ? { ...p, ratePerNight: rate } : p)));
  }

  function updateRoomDate(roomId: string, field: 'checkIn' | 'checkOut', value: string) {
    setPicked((prev) => prev.map((p) => (p.room.id === roomId ? { ...p, [field]: value } : p)));
  }

  function resetRoomDates(roomId: string) {
    setPicked((prev) => prev.map((p) => (p.room.id === roomId ? { ...p, checkIn: undefined, checkOut: undefined } : p)));
    setEditingDatesFor(null);
  }

  async function submit() {
    setError(null);
    if (!guestName.trim()) {
      setError('Guest name is required');
      return;
    }
    if (picked.length === 0) {
      setError('Add at least one room');
      return;
    }
    if (guestPhone && guestPhone.length !== 10) {
      setError('Contact number must be exactly 10 digits');
      return;
    }
    if (isCorporate && !companyName.trim()) {
      setError('Company name is required for a corporate booking');
      return;
    }
    setSubmitting(true);
    try {
      const shared = {
        hotelId,
        source,
        checkIn,
        checkOut,
        guestName,
        guestPhone: guestPhone || undefined,
        guestEmail: guestEmail || undefined,
        specialRequest: specialRequest || undefined,
        companyName: isCorporate ? companyName.trim() : undefined,
        companyTaxIdType: isCorporate ? companyTaxIdType : undefined,
        companyGstin: isCorporate ? companyGstin.trim() || undefined : undefined,
        companyPhone: isCorporate ? companyPhone.trim() || undefined : undefined,
        companyEmail: isCorporate ? companyEmail.trim() || undefined : undefined,
        companyAddress: isCorporate ? companyAddress.trim() || undefined : undefined,
        companyCountry: isCorporate ? companyCountry.trim() || undefined : undefined,
        companyState: isCorporate ? companyState.trim() || undefined : undefined,
        companyCity: isCorporate ? companyCity.trim() || undefined : undefined,
        companyPincode: isCorporate ? companyPincode.trim() || undefined : undefined,
        rooms: roomsWithBase.map((p) => ({
          roomId: p.room.id,
          totalAmount: p.base,
          ratePlanId: p.ratePlanId || undefined,
          checkIn: p.checkIn || undefined,
          checkOut: p.checkOut || undefined,
          lineItems: p.lineItems.length > 0 ? p.lineItems.map((li) => ({ description: li.description, quantity: li.quantity, unitPrice: li.unitPrice })) : undefined,
          discountAmount:
            effectiveDiscountAmount > 0 && discountBase > 0
              ? Math.round(((p.base + p.extraChargesSum) / discountBase) * effectiveDiscountAmount * 100) / 100
              : undefined,
          gstExempt: gstMode === 'exempt' ? true : undefined,
        })),
      };
      if (isEditMode) {
        const reservationGroupId = editGroup![0].reservationGroupId ?? editGroup![0].id;
        await mutate('bookings.updateReservationGroup', { ...shared, reservationGroupId }, token ?? undefined);
      } else {
        await mutate(
          'bookings.createMultiRoomReservation',
          { ...shared, advanceAmount: advanceAmount > 0 ? advanceAmount : undefined, paymentMethod: advanceAmount > 0 ? paymentMethod : undefined },
          token ?? undefined,
        );
      }
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Failed to ${isEditMode ? 'save' : 'create'} reservation`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="w-full max-w-xl" onClick={(e) => e.stopPropagation()}>
        <Card className="flex max-h-[92vh] flex-col overflow-hidden rounded-b-none sm:rounded-b-xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-700">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">{isEditMode ? 'Edit Reservation' : 'Create Reservation'}</h3>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300">
              ✕
            </button>
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">Reservation Details</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label="Source">
                  <select className={inputClass} value={source} onChange={(e) => setSource(e.target.value)}>
                    {SOURCE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Check-in">
                  <input className={inputClass} type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
                </Field>
                <Field label="Check-out">
                  <input className={inputClass} type="date" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} min={checkIn} />
                </Field>
              </div>
              <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">{nights} night{nights === 1 ? '' : 's'}</p>
            </div>

            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">Guest Details</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Name">
                  <input className={inputClass} value={guestName} onChange={(e) => setGuestName(e.target.value)} required />
                </Field>
                <Field label="Contact No">
                  <input
                    className={inputClass}
                    value={guestPhone}
                    onChange={(e) => setGuestPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                    placeholder="10-digit mobile"
                  />
                </Field>
                <Field label="Email">
                  <input className={inputClass} type="email" value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} />
                </Field>
                <Field label="Special Requests">
                  <input className={inputClass} value={specialRequest} onChange={(e) => setSpecialRequest(e.target.value)} />
                </Field>
              </div>

              {/* §user request — "corporate booking vala nahi dala hai", then a reference app's
                  own Individual/Company toggle as the target: Individual is the ordinary flow
                  unchanged; Company reveals the full company-billing form below and bills the
                  whole reservation to it (for their GST input credit) instead of the guest. */}
              <div className="mt-3 flex rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
                {(['individual', 'company'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setGuestType(t)}
                    className={`flex-1 rounded-md py-1.5 text-xs font-semibold capitalize transition-colors ${
                      guestType === t ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white' : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {t === 'company' ? '🏢 Company' : '👤 Individual'}
                  </button>
                ))}
              </div>
              {isCorporate && (
                <div className="mt-2.5 space-y-2.5 rounded-lg bg-slate-50 p-2.5 dark:bg-slate-900/40">
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    <Field label="Tax ID Type">
                      <select className={inputClass} value={companyTaxIdType} onChange={(e) => setCompanyTaxIdType(e.target.value)}>
                        <option value="GSTIN">GSTIN</option>
                        <option value="PAN">PAN</option>
                        <option value="Other">Other</option>
                      </select>
                    </Field>
                    <Field label="Tax ID Number">
                      <input className={inputClass} value={companyGstin} onChange={(e) => setCompanyGstin(e.target.value)} placeholder="Enter Tax Identification Number" />
                    </Field>
                    <Field label="Company Name">
                      <input className={inputClass} value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="e.g. Acme Pvt Ltd" required />
                    </Field>
                    <Field label="Company Phone">
                      <input className={inputClass} value={companyPhone} onChange={(e) => setCompanyPhone(e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="10-digit mobile" />
                    </Field>
                  </div>
                  <Field label="Company Email">
                    <input className={inputClass} type="email" value={companyEmail} onChange={(e) => setCompanyEmail(e.target.value)} />
                  </Field>
                  <Field label="Address">
                    <textarea className={`${inputClass} min-h-14`} value={companyAddress} onChange={(e) => setCompanyAddress(e.target.value)} />
                  </Field>
                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                    <Field label="Country">
                      <input className={inputClass} value={companyCountry} onChange={(e) => setCompanyCountry(e.target.value)} />
                    </Field>
                    <Field label="State">
                      <input className={inputClass} value={companyState} onChange={(e) => setCompanyState(e.target.value)} />
                    </Field>
                    <Field label="City">
                      <input className={inputClass} value={companyCity} onChange={(e) => setCompanyCity(e.target.value)} />
                    </Field>
                    <Field label="Pincode">
                      <input className={inputClass} value={companyPincode} onChange={(e) => setCompanyPincode(e.target.value)} />
                    </Field>
                  </div>
                </div>
              )}
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">Rooms</p>
              </div>
              <div className="space-y-2.5">
                {roomsWithBase.map((p) => {
                  const roomRatePlans = ratePlans.filter((rp) => rp.roomCategoryId === p.room.roomCategoryId);
                  const hasCustomDates = Boolean(p.checkIn || p.checkOut);
                  return (
                    <div key={p.room.id} className="rounded-xl border border-slate-200 p-3.5 dark:border-slate-700">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-bold text-slate-900 dark:text-white">Room: {p.room.roomNumber}</p>
                          <p className="text-xs text-slate-400 dark:text-slate-500">{p.room.roomCategory?.name ?? '—'}</p>
                          {/* §user request — bulk/wedding reservations can need different dates per room; this
                              chip defaults to the reservation's own dates and only diverges when edited. */}
                          <button
                            type="button"
                            onClick={() => setEditingDatesFor(editingDatesFor === p.room.id ? null : p.room.id)}
                            className="mt-1 inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
                          >
                            📅 {formatDateShort(p.checkIn || checkIn)} – {formatDateShort(p.checkOut || checkOut)} · {p.roomStayNights} night{p.roomStayNights === 1 ? '' : 's'}
                            {hasCustomDates && <span className="text-brand-600 dark:text-brand-400">(custom)</span>}
                          </button>
                        </div>
                        <button type="button" onClick={() => removeRoom(p.room.id)} className="text-red-500 hover:text-red-700 dark:text-red-400">
                          🗑
                        </button>
                      </div>

                      {editingDatesFor === p.room.id && (
                        <div className="mt-2.5 rounded-lg bg-slate-50 p-2.5 dark:bg-slate-900/40">
                          <div className="grid grid-cols-2 gap-2.5">
                            <Field label="Check-in">
                              <input
                                className={inputClass}
                                type="date"
                                value={p.checkIn || checkIn}
                                onChange={(e) => updateRoomDate(p.room.id, 'checkIn', e.target.value)}
                              />
                            </Field>
                            <Field label="Check-out">
                              <input
                                className={inputClass}
                                type="date"
                                value={p.checkOut || checkOut}
                                min={p.checkIn || checkIn}
                                onChange={(e) => updateRoomDate(p.room.id, 'checkOut', e.target.value)}
                              />
                            </Field>
                          </div>
                          {hasCustomDates && (
                            <button type="button" onClick={() => resetRoomDates(p.room.id)} className="mt-1.5 text-xs text-brand-600 hover:underline dark:text-brand-400">
                              Reset to reservation dates
                            </button>
                          )}
                        </div>
                      )}

                      <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                        <Field label="Rate Plan">
                          <select className={inputClass} value={p.ratePlanId} onChange={(e) => updateRatePlan(p.room.id, e.target.value)}>
                            <option value="">— none —</option>
                            {roomRatePlans.map((rp) => (
                              <option key={rp.id} value={rp.id}>
                                {rp.mealPlan ? `${rp.name} (${rp.mealPlan})` : rp.name}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <div className="flex items-end gap-1.5">
                          <div className="flex-1">
                            <Field
                              label={`Rate /night (₹, ${gstMode === 'inclusive' ? 'incl. GST' : gstMode === 'exempt' ? 'GST exempt' : 'excl. GST'})`}
                            >
                              <input
                                className={inputClass}
                                type="number"
                                min={0}
                                value={p.ratePerNight}
                                onChange={(e) => updateRate(p.room.id, Number(e.target.value))}
                              />
                            </Field>
                            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                              ₹{p.ratePerNight || 0} × {p.roomStayNights} night{p.roomStayNights === 1 ? '' : 's'} = <span className="font-semibold text-slate-600 dark:text-slate-300">₹{p.totalAmount.toFixed(2)}</span>
                            </p>
                          </div>
                          {/* §user request — "+ icon jisme hum room ADD ON ke extra charges le sake, jaise extra
                              mattress and others": same InvoiceLineItem mechanism check-in's "+ Add Extra Charges"
                              already uses, one line-item list per room. */}
                          <button
                            type="button"
                            onClick={() => setAddingChargeFor(addingChargeFor === p.room.id ? null : p.room.id)}
                            title="Add-on / extra charge"
                            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-dashed border-slate-300 text-lg font-bold text-brand-600 hover:border-brand-400 hover:bg-brand-50/40 dark:border-slate-600 dark:text-brand-400 dark:hover:bg-brand-500/10"
                          >
                            +
                          </button>
                        </div>
                      </div>

                      {p.lineItems.length > 0 && (
                        <div className="mt-2.5 space-y-1.5">
                          {p.lineItems.map((li) => (
                            <div key={li.key} className="flex items-center justify-between rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs dark:bg-slate-900/40">
                              <span className="text-slate-600 dark:text-slate-300">
                                {li.description} {li.quantity > 1 ? `× ${li.quantity}` : ''}
                              </span>
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-slate-700 dark:text-slate-200">₹{li.amount.toFixed(2)}</span>
                                <button type="button" onClick={() => removeCharge(p.room.id, li.key)} className="text-red-500 hover:underline">
                                  Remove
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {addingChargeFor === p.room.id && (
                        <form onSubmit={(e) => addCharge(e, p.room.id)} className="mt-2.5 grid grid-cols-4 gap-2">
                          <input
                            className={`${inputClass} col-span-2`}
                            placeholder="e.g. Extra mattress"
                            value={chargeDesc}
                            onChange={(e) => setChargeDesc(e.target.value)}
                            required
                            autoFocus
                          />
                          <input
                            className={inputClass}
                            type="number"
                            placeholder="Qty 1"
                            value={chargeQty}
                            onChange={(e) => setChargeQty(e.target.value === '' ? '' : Number(e.target.value))}
                            min={1}
                          />
                          <input
                            className={inputClass}
                            type="number"
                            placeholder="₹ price"
                            value={chargeUnitPrice}
                            onChange={(e) => setChargeUnitPrice(e.target.value === '' ? '' : Number(e.target.value))}
                            min={0}
                          />
                          <div className="col-span-4 flex gap-2">
                            <Button type="submit" variant="secondary" className="flex-1">
                              Add
                            </Button>
                            <Button type="button" variant="ghost" onClick={() => setAddingChargeFor(null)}>
                              ✕
                            </Button>
                          </div>
                        </form>
                      )}
                    </div>
                  );
                })}
                <button
                  type="button"
                  onClick={openPicker}
                  disabled={loadingRooms}
                  className="w-full rounded-xl border border-dashed border-slate-300 py-3 text-sm font-semibold text-brand-600 hover:border-brand-400 hover:bg-brand-50/40 disabled:opacity-50 dark:border-slate-600 dark:text-brand-400 dark:hover:bg-brand-500/10"
                >
                  {loadingRooms ? 'Loading rooms…' : '+ Add Room'}
                </button>
              </div>
            </div>

            {picked.length > 0 && (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 p-3.5 dark:border-slate-700">
                    <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">GST & Tax</p>
                    <div className="flex rounded-lg bg-slate-100 p-1 dark:bg-slate-700">
                      {(['exclusive', 'inclusive', 'exempt'] as GstMode[]).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setGstMode(m)}
                          className={`flex-1 rounded-md py-1.5 text-xs font-semibold capitalize transition-colors ${
                            gstMode === m ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                      {gstMode === 'exempt' ? (
                        'No GST applied'
                      ) : (
                        <>
                          Added {gstMode === 'inclusive' ? 'inside' : 'on top of'} the room charge
                        </>
                      )}
                    </p>
                  </div>

                  <div className={`rounded-xl border p-3.5 transition-colors ${discountEnabled ? 'border-brand-200 bg-brand-50/40 dark:border-brand-500/30 dark:bg-brand-500/10' : 'border-slate-200 dark:border-slate-700'}`}>
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-xs font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">Discount</p>
                      <button
                        type="button"
                        onClick={() => setDiscountEnabled((v) => !v)}
                        className={`relative h-5 w-9 rounded-full transition-colors ${discountEnabled ? 'bg-brand-600' : 'bg-slate-300 dark:bg-slate-600'}`}
                      >
                        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${discountEnabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                      </button>
                    </div>
                    {discountEnabled && (
                      <>
                        <div className="mb-2 flex rounded-lg bg-slate-100 p-1 dark:bg-slate-700">
                          <button
                            type="button"
                            onClick={() => setDiscountType('percent')}
                            className={`flex-1 rounded-md py-1.5 text-xs font-semibold transition-colors ${discountType === 'percent' ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}
                          >
                            %
                          </button>
                          <button
                            type="button"
                            onClick={() => setDiscountType('flat')}
                            className={`flex-1 rounded-md py-1.5 text-xs font-semibold transition-colors ${discountType === 'flat' ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}
                          >
                            ₹
                          </button>
                        </div>
                        {discountType === 'percent' ? (
                          <div className="flex items-center gap-2.5">
                            <input
                              type="range"
                              min={0}
                              max={100}
                              value={discountPercent}
                              onChange={(e) => setDiscountPercent(Number(e.target.value))}
                              className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-brand-100 accent-brand-600 dark:bg-brand-500/20"
                            />
                            <span className="rounded-full bg-brand-600 px-2 py-0.5 text-xs font-semibold text-white">{discountPercent}%</span>
                          </div>
                        ) : (
                          <input
                            className={inputClass}
                            type="number"
                            min={0}
                            value={discountAmount}
                            onChange={(e) => setDiscountAmountValue(e.target.value === '' ? '' : Number(e.target.value))}
                            placeholder="Discount amount (₹)"
                          />
                        )}
                      </>
                    )}
                  </div>
                </div>

                <div className="space-y-1.5 rounded-xl border border-slate-200 p-3.5 text-sm dark:border-slate-700">
                  <div className="flex justify-between text-slate-500 dark:text-slate-400">
                    <span>Room charges</span>
                    <span>₹{baseTotal.toFixed(2)}</span>
                  </div>
                  {totals.extraCharges > 0 && (
                    <div className="flex justify-between text-slate-500 dark:text-slate-400">
                      <span>Add-ons</span>
                      <span>₹{totals.extraCharges.toFixed(2)}</span>
                    </div>
                  )}
                  {totals.discount > 0 && (
                    <div className="flex justify-between text-amber-600 dark:text-amber-400">
                      <span>Discount</span>
                      <span>−₹{totals.discount.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-slate-500 dark:text-slate-400">
                    <span>GST ({totals.gst.label}{gstMode === 'inclusive' ? ' · included' : ''})</span>
                    <span>₹{totals.gst.amount.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between border-t border-slate-100 pt-1.5 text-sm font-bold text-slate-900 dark:border-slate-700 dark:text-white">
                    <span>Total</span>
                    <span>₹{grandTotal.toFixed(2)}</span>
                  </div>
                </div>
              </>
            )}

            {/* Edit mode never records a new payment through this form — that's Add Payment's
                job, kept untouched so the group's existing ledger isn't duplicated. */}
            {!isEditMode && (
              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">Payment Details</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Advance (₹)">
                    <input className={inputClass} type="number" min={0} max={grandTotal} value={advanceAmount} onChange={(e) => setAdvanceAmount(Number(e.target.value))} />
                  </Field>
                  <Field label="Payment Mode">
                    <select className={inputClass} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)} disabled={advanceAmount <= 0}>
                      {METHOD_OPTIONS.map((m) => (
                        <option key={m} value={m}>
                          {paymentMethodLabel(m)}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-4 dark:border-slate-700">
            <div className="text-sm">
              <span className="font-bold text-amber-600 dark:text-amber-400">₹{due.toFixed(2)}</span>
              <span className="text-slate-400 dark:text-slate-500"> due of ₹{grandTotal.toFixed(2)}{isEditMode && alreadyPaid > 0 ? ` (₹${alreadyPaid.toFixed(2)} already paid)` : ''}</span>
            </div>
            <Button type="button" onClick={submit} disabled={submitting || picked.length === 0}>
              {isEditMode ? (submitting ? 'Saving…' : 'Save Changes') : submitting ? 'Creating…' : 'Create Reservation'}
            </Button>
          </div>
        </Card>
      </div>

      {pickerOpen && (
        <RoomPickerModal
          rooms={availableRooms}
          checkIn={checkIn}
          checkOut={checkOut}
          selectedIds={draftSelectedIds}
          onToggle={(id) => setDraftSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))}
          onClose={() => setPickerOpen(false)}
          onContinue={confirmPicker}
        />
      )}
    </div>
  );
}
