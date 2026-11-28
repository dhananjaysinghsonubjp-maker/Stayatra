import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { mutate, query, ApiError } from '../../api';
import { useAuth } from '../../AuthContext';
import { BOOKING_SOURCE_OPTIONS } from '../../bookingSource';
import { Button, Card, Combobox, Field, inputClass } from '../../components/ui';
import { addDaysKey } from '../../components/DateRangePicker';
import { formatDateShort } from '../../dateFormat';
import { computeGstSlab } from '../../gst';
import { computeInvoiceTotals } from '../../invoice';
import { RoomPickerModal } from './RoomPickerModal';
import { ReservationSuccessModal, type ReservationSuccessData } from './ReservationSuccessModal';
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

// Now shared with checkin/CheckInModal's own Booking Source field — see bookingSource.ts.
const SOURCE_OPTIONS = BOOKING_SOURCE_OPTIONS;

// §user request, with a reference app's own icon+description Payment Mode list as the target —
// same copy/icon per mode wherever this dropdown shows up, mapped onto our actual PaymentMethod
// enum values (there's no separate "Paytm"/"PrepaidWithOTA" column in our schema, so those fold
// into the closest real mode — online/credit_sale — instead of inventing new ones).
const PAYMENT_METHOD_OPTIONS: { value: PaymentMethod; label: string; description: string; icon: string }[] = [
  { value: 'cash', label: 'Cash', description: 'Pay the advance using cash', icon: '💵' },
  { value: 'upi', label: 'UPI', description: 'Pay instantly using a UPI app', icon: '📲' },
  { value: 'online', label: 'Online', description: 'Online payment gateway or wallet', icon: '🌐' },
  { value: 'card', label: 'Card', description: 'Card swipe via POS terminal', icon: '💳' },
  { value: 'bank_transfer', label: 'Bank Transfer', description: 'NEFT / IMPS / RTGS to the hotel account', icon: '🏦' },
  { value: 'cheque', label: 'Cheque', description: 'Payment by cheque', icon: '🧾' },
  { value: 'cash_deposit', label: 'Cash Deposit', description: 'Deposited directly into the bank account', icon: '🏧' },
  { value: 'credit_sale', label: 'Credit Sale', description: 'Billed to the guest, payment pending', icon: '📄' },
  { value: 'company_settlement', label: 'Company Settlement', description: 'Billed to and settled by the company', icon: '🏢' },
  { value: 'agent_settlement', label: 'Agent Settlement', description: 'Billed to and settled by the travel agent', icon: '🧳' },
];

interface PaymentRow {
  key: string;
  method: PaymentMethod;
  amount: number | '';
  referenceNumber: string;
}

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
  initialRoomId,
  initialCheckIn,
}: {
  hotelId: string;
  onClose: () => void;
  onDone: () => void;
  /** §user request, with a reference app's own calendar-bar "Edit reservation" as the target —
   * every Booking row sharing one reservationGroupId, prefilling this same form instead of a
   * blank one and saving via bookings.updateReservationGroup instead of create. */
  editGroup?: Booking[];
  /** §user request — Calendar's empty-cell menu on a future date: "Check In" only makes sense for
   * a guest arriving right now, so a future date opens this form instead, with the room the click
   * landed on and that date already picked — same one-less-step prefill CheckInModal's own `room`
   * prop already gives the walk-in flow. */
  initialRoomId?: string;
  initialCheckIn?: string;
}) {
  const { token } = useAuth();
  const isEditMode = Boolean(editGroup && editGroup.length > 0);
  // §user request — "Direct aur Walk-in dono same baat hai, Direct hata do": 'direct' is no longer
  // a selectable option (bookingSource.ts), so the default has to be a value that's actually in
  // the list now.
  const [source, setSource] = useState('walk_in');
  const [checkIn, setCheckIn] = useState(todayPlus(0));
  const [checkOut, setCheckOut] = useState(todayPlus(1));
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [specialRequest, setSpecialRequest] = useState('');

  const [picked, setPicked] = useState<PickedRoom[]>([]);
  // §user request — "ek simple per-room rent daalu aur side mein ek checkbox 'apply to all', to
  // automatically niche sab rooms mein rent likha aa jaaye": a one-shot bulk-fill, not a persistent
  // link — checking the box and typing here pushes that rate into every picked room's own rate
  // field as you type, but each room's field stays independently editable afterward (typing in one
  // room's own rate never un-fills the others, and nothing stops fine-tuning one room's amount
  // after the bulk-fill, exactly like the summary-then-override flow asked for).
  const [applyRateToAll, setApplyRateToAll] = useState(false);
  const [masterRate, setMasterRate] = useState<number | ''>('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [stayPickerOpen, setStayPickerOpen] = useState(false);
  const [successData, setSuccessData] = useState<ReservationSuccessData | null>(null);
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

  // §user request — "cash aur UPI dono diya toh hum dono add kar sakein, +Add Payment ka option":
  // an advance can arrive split across more than one mode in a single sitting, so this is a list
  // of rows (one mode + amount + optional reference each) instead of a single pair — summed into
  // one `advanceAmount` below for the due/grand-total math, and sent to the API as `payments` so
  // each mode lands as its own Payment ledger row (createMultiRoomReservation prorates each entry
  // per room exactly like it already did for the old single advanceAmount/paymentMethod pair).
  const [paymentRows, setPaymentRows] = useState<PaymentRow[]>([{ key: 'p1', method: 'upi', amount: '', referenceNumber: '' }]);
  const advanceAmount = paymentRows.reduce((sum, r) => sum + (r.amount === '' ? 0 : r.amount), 0);

  function addPaymentRow() {
    setPaymentRows((prev) => [...prev, { key: `p${Date.now()}`, method: 'cash', amount: '', referenceNumber: '' }]);
  }
  function removePaymentRow(key: string) {
    setPaymentRows((prev) => prev.filter((r) => r.key !== key));
  }
  function updatePaymentRow(key: string, patch: Partial<PaymentRow>) {
    setPaymentRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

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
  // §user request — "pehli baar advance aaya hai toh ye 2 baar kyun hai": a fast double-click on
  // Create Reservation fires two click events before React's disabled={submitting} re-render
  // actually commits, so both still read the stale submitting=false and both submit — a real
  // second reservation+payment, not a display bug. A ref (synchronous, unlike state) blocks it.
  const submittingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  // §user request, with a reference app's own slide-over as the target — opens as a right-side
  // panel on desktop (bottom sheet on phone) instead of a centered dialog, sliding in smoothly
  // instead of just appearing. Mounts off-screen (`entered` false) and slides in one frame later;
  // closing reverses that before the parent actually unmounts this component.
  const [entered, setEntered] = useState(false);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);
  function handleClose() {
    setClosing(true);
    setTimeout(onClose, 220);
  }

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

  // §user request — Calendar's empty-cell menu on a future date prefills this form instead of
  // opening blank: the clicked date becomes check-in/check-out (one night, same as the form's own
  // default), and the clicked room is pre-added to `picked` exactly like confirmPicker would add
  // it (rate left at 0 — the owner still reviews/sets the price here, same as picking manually).
  useEffect(() => {
    if (editGroup && editGroup.length > 0) return; // edit mode's own effect above already wins
    if (!initialRoomId || !initialCheckIn) return;
    const effCheckIn = initialCheckIn;
    const effCheckOut = addDaysKey(initialCheckIn, 1);
    setCheckIn(effCheckIn);
    setCheckOut(effCheckOut);
    (async () => {
      try {
        const rooms = await query<(Room & { available: boolean })[]>(
          'bookings.listRoomsWithAvailability',
          { hotelId, checkIn: effCheckIn, checkOut: effCheckOut },
          token ?? undefined,
        );
        setAvailableRooms(rooms);
        const room = rooms.find((r) => r.id === initialRoomId);
        if (room) setPicked([{ room, ratePerNight: 0, ratePlanId: '', lineItems: [] }]);
      } catch {
        // Room picker still opens empty and lets the room be added manually either way.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRoomId, initialCheckIn]);

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

  // §user request, with a reference app's own Booking Summary sidebar as the target — "Room
  // Charges" there groups by room TYPE, not by the specific physical rooms picked; grouping
  // roomsWithBase (already computed, pre-discount/pre-GST) by category here is purely a display
  // reshape for the sidebar, no new pricing logic.
  const roomChargesByCategory = (() => {
    const byCategory = new Map<string, { name: string; count: number; amount: number }>();
    for (const p of roomsWithBase) {
      const key = p.room.roomCategoryId ?? p.room.id;
      const name = p.room.roomCategory?.name ?? p.room.roomNumber;
      const existing = byCategory.get(key);
      if (existing) {
        existing.count += 1;
        existing.amount += p.base;
      } else {
        byCategory.set(key, { name, count: 1, amount: p.base });
      }
    }
    return [...byCategory.values()];
  })();

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

  function applyMasterRate(rate: number | '') {
    setMasterRate(rate);
    if (applyRateToAll && rate !== '') setPicked((prev) => prev.map((p) => ({ ...p, ratePerNight: rate })));
  }

  function toggleApplyRateToAll(next: boolean) {
    setApplyRateToAll(next);
    if (next && masterRate !== '') setPicked((prev) => prev.map((p) => ({ ...p, ratePerNight: Number(masterRate) })));
  }

  function updateRoomDate(roomId: string, field: 'checkIn' | 'checkOut', value: string) {
    setPicked((prev) => prev.map((p) => (p.room.id === roomId ? { ...p, [field]: value } : p)));
  }

  function resetRoomDates(roomId: string) {
    setPicked((prev) => prev.map((p) => (p.room.id === roomId ? { ...p, checkIn: undefined, checkOut: undefined } : p)));
    setEditingDatesFor(null);
  }

  async function submit() {
    if (submittingRef.current) return;
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
    if (isCorporate && companyPhone && companyPhone.length !== 10) {
      setError('Company phone must be exactly 10 digits');
      return;
    }
    submittingRef.current = true;
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
        onDone();
        onClose();
        return;
      }

      const paymentTimestamp = new Date().toISOString();
      const payments = paymentRows
        .filter((r) => r.amount !== '' && r.amount > 0)
        .map((r) => ({ amount: r.amount as number, method: r.method, referenceNumber: r.referenceNumber.trim() || undefined, collectedAt: paymentTimestamp }));
      // ReservationSuccessData's own payments need a display label, not the raw enum the API call
      // above uses — kept as a separate array rather than changing `payments` itself.
      const paymentsForReceipt = payments.map((p) => ({
        modeLabel: PAYMENT_METHOD_OPTIONS.find((o) => o.value === p.method)?.label ?? p.method,
        amount: p.amount,
        referenceNumber: p.referenceNumber,
        collectedAt: p.collectedAt,
      }));
      const created = await mutate<Booking[]>(
        'bookings.createMultiRoomReservation',
        { ...shared, payments: payments.length > 0 ? payments : undefined },
        token ?? undefined,
      );
      // §bugfix — every caller's own `onDone` prop both refreshes ITS data AND immediately
      // unmounts this whole modal (e.g. Bookings.tsx's `setShowCreate(false)`), so calling it
      // here (like the old single `onDone(); onClose();` tail used to) destroyed the success
      // popup's own state before React ever got to render it. `onDone` is now deferred to the
      // popup's own Close button instead — see the <ReservationSuccessModal> render below.
      // §user request — "reservation create karne ke baad ek popup aana chahiye jisme Advance
      // Receipt aur Booking Voucher ki PDF ban sake": shown instead of closing immediately —
      // closing the whole panel is deferred to the popup's own Close button.
      setSuccessData({
        hotelId,
        bookingCode: `BK-${(created[0]?.id ?? '').slice(-6).toUpperCase()}`,
        createdAt: paymentTimestamp,
        guestName,
        guestPhone: guestPhone || undefined,
        companyName: isCorporate ? companyName.trim() || undefined : undefined,
        companyGstin: isCorporate ? companyGstin.trim() || undefined : undefined,
        checkIn,
        checkOut,
        nights,
        rooms: roomsWithBase.map((p) => ({
          roomNumber: p.room.roomNumber,
          categoryName: p.room.roomCategory?.name ?? '—',
          ratePlanName: ratePlans.find((rp) => rp.id === p.ratePlanId)?.name,
          ratePerNight: p.ratePerNight,
          nights: p.roomStayNights,
          total: p.base,
        })),
        extraCharges: totals.extraCharges,
        discount: totals.discount,
        gstAmount: totals.gst.amount,
        gstLabel: totals.gst.label,
        grandTotal,
        advanceAmount,
        due,
        payments: paymentsForReceipt,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Failed to ${isEditMode ? 'save' : 'create'} reservation`);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    // §user request — "bahar click karne se draft lost ho jaata hai": the backdrop used to close
    // this on click, same as a typical dialog, but a half-written multi-room reservation is
    // expensive to lose to one stray click outside the panel. Only the ✕ button closes it now —
    // no onClick here at all, not even a guarded one, since a guard would still need to pick some
    // notion of "unsaved changes" to ask about, and the simplest, least surprising fix is this
    // panel just never closes itself from an outside click, full stop.
    <div className={`fixed inset-0 z-50 bg-black/30 transition-opacity duration-300 ${entered && !closing ? 'opacity-100' : 'opacity-0'}`}>
      <Card
        onClick={(e) => e.stopPropagation()}
        className={`fixed inset-x-0 bottom-0 flex max-h-[92vh] w-full flex-col overflow-hidden rounded-b-none rounded-t-2xl shadow-2xl transition-transform duration-300 ease-out sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-full sm:w-full sm:max-w-6xl sm:rounded-none ${
          entered && !closing ? 'translate-y-0 sm:translate-x-0' : 'translate-y-full sm:translate-y-0 sm:translate-x-full'
        }`}
      >
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-700">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">{isEditMode ? 'Edit Reservation' : 'Create Reservation'}</h3>
            <button onClick={handleClose} className="text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300">
              ✕
            </button>
          </div>

          {/* §user request, with a reference app's own wide two-column Create Reservation screen
              as the target — "slider bada banega, dates > Rooms > Guest Details > Payment Details
              order mein ho, aur side mein Booking Summary bane": the panel itself is much wider
              now (sm:max-w-6xl above) to fit a sticky summary sidebar alongside the form, and the
              form's own sections reorder via a plain CSS `order` on each (flex-col below) rather
              than physically moving ~300 lines of JSX around — every section's own content and
              handlers are completely untouched, only their visual position changes. */}
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {error && <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
            <div className="flex flex-col gap-5">
            {/* §user request — "jaise humne stay details, guest details, rooms section har
                selection ek ek box banaya hai with little shadow, vese hi reservation ki process
                mein bhi karo": each top-level section is now its own shadowed Card instead of
                just floating text + controls, matching Check-in's own section cards. */}
            <Card className="order-1 p-4">
              {/* §user request, with a reference app's own Stay Details header as the target —
                  icon chip + title + one-line subtitle, matching Check-in's own SectionHeader
                  style elsewhere in this app. */}
              <div className="mb-2 flex items-center gap-2.5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-sm dark:bg-brand-500/10">🏠</span>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-700 dark:text-slate-200">Stay Details</p>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500">Stay dates and arrival details for availability and pricing.</p>
                </div>
              </div>
              {/* §user request — "iske click karne ke baad calendar khul jaaye and usse date
                  select kar sake": same Check In / Check Out box pair Check-in's own Stay Details
                  card uses, now opening a real calendar (StayDateRangeModal below) instead of the
                  browser's bare native date inputs. Source moved down into Guest Details below. */}
              <button type="button" onClick={() => setStayPickerOpen(true)} className="flex w-full items-center gap-2 rounded-lg text-left">
                <div className="min-w-0 flex-1 rounded-lg bg-brand-50 px-3 py-2 dark:bg-brand-500/10">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-400">Check In</p>
                  <p className="truncate text-sm font-bold text-slate-900 dark:text-white">{formatDateShort(checkIn)}</p>
                </div>
                <span className="shrink-0 text-slate-400">→</span>
                <div className="min-w-0 flex-1 rounded-lg bg-amber-50 px-3 py-2 dark:bg-amber-500/10">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">Check Out</p>
                  <p className="truncate text-sm font-bold text-slate-900 dark:text-white">{formatDateShort(checkOut)}</p>
                </div>
              </button>
              <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">{nights} night{nights === 1 ? '' : 's'}</p>
            </Card>

            <Card className="order-3 p-4">
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
                {/* §user request — "source ko niche le jao guest details k andar": moved down from
                    Stay Details, and restyled as the same click-to-open list dropdown the
                    reference app's own Booking Source field uses. */}
                <Field label="Booking Source">
                  <Combobox value={source} options={SOURCE_OPTIONS} onChange={setSource} />
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
            </Card>

            <Card className="order-2 p-4">
              {/* §user request, with a reference app's own Rooms Selection table as the target —
                  icon+title header, a master-rate bar with a date/nights badge next to it, then
                  one bordered list of compact zebra-striped rows (not a stack of big per-room
                  cards) so room no./plan/price read like a real table while staying editable. */}
              <div className="mb-3 flex items-center gap-2.5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-sm dark:bg-brand-500/10">🛏️</span>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-700 dark:text-slate-200">Rooms Selection</p>
                  {isEditMode && (
                    <p className="text-[11px] text-slate-400 dark:text-slate-500">Rate/meal plan are locked — use Discount, an add-on charge, or More Actions → Change meal plan.</p>
                  )}
                </div>
              </div>
              {/* §user request — "ek simple per room rent daalu aur side mein checkbox 'apply to
                  all', to automatically niche sab rooms mein rent likha aa jaaye": one master rate,
                  pushed into every room's own field below while the box stays checked; each room's
                  own figure in the summary stays editable afterward for a one-off override. Only
                  worth showing once there's more than one room to spread a rate across. */}
              {/* §user request, with a reference app's own master-rate bar as the target — label +
                  date badge on top, then the rate input and "Apply to all" checkbox always in one
                  row (not stacking on narrow widths) with a highlighted brand-colored input. */}
              {/* §user request — "edit karni ho toh price mein jo tha vo change nahi hoga, sirf
                  discount ya add-on charges": the agreed rate is locked once a reservation
                  exists — a genuinely different rate means cancelling and creating a new one, not
                  editing this one. Rate/meal-plan inputs below are disabled in edit mode;
                  Discount and the per-room "+" add-on charge stay the only things that can still
                  move the total. */}
              {picked.length > 1 && !isEditMode && (
                <div className="mb-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-900/40">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-1.5">
                    <label className="text-sm font-semibold text-slate-700 dark:text-slate-200">Rate /night for all rooms (₹)</label>
                    <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-500 shadow-sm dark:bg-slate-800 dark:text-slate-400">
                      📅 {formatDateShort(checkIn)} – {formatDateShort(checkOut)} · {nights} night{nights === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <input
                      className="flex-1 rounded-lg border border-brand-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:border-brand-500/40 dark:bg-slate-800 dark:text-white"
                      type="number"
                      min={0}
                      placeholder="e.g. 3500"
                      value={masterRate}
                      onChange={(e) => applyMasterRate(e.target.value === '' ? '' : Number(e.target.value))}
                    />
                    <label className="flex shrink-0 items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                      <input
                        type="checkbox"
                        checked={applyRateToAll}
                        onChange={(e) => toggleApplyRateToAll(e.target.checked)}
                        className="h-5 w-5 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                      />
                      Apply to all
                    </label>
                  </div>
                </div>
              )}
              <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
                {roomsWithBase.map((p, i) => {
                  const roomRatePlans = ratePlans.filter((rp) => rp.roomCategoryId === p.room.roomCategoryId);
                  const hasCustomDates = Boolean(p.checkIn || p.checkOut);
                  return (
                    <div
                      key={p.room.id}
                      className={`p-3 ${i > 0 ? 'border-t border-slate-100 dark:border-slate-700' : ''} ${i % 2 === 1 ? 'bg-slate-50/70 dark:bg-slate-900/30' : ''}`}
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-base shadow-sm dark:bg-slate-800">🛏️</span>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-bold text-slate-900 dark:text-white">Room {p.room.roomNumber}</p>
                            <p className="truncate text-xs text-slate-400 dark:text-slate-500">{p.room.roomCategory?.name ?? '—'}</p>
                          </div>
                        </div>

                        <div className="flex flex-wrap shrink-0 items-end gap-2.5">
                          <div className="w-32">
                            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Meal Plan</p>
                            <select
                              disabled={isEditMode}
                              title={isEditMode ? 'Use More Actions → Change meal plan instead' : undefined}
                              className="w-full truncate rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-600 outline-none disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300"
                              value={p.ratePlanId}
                              onChange={(e) => updateRatePlan(p.room.id, e.target.value)}
                            >
                              <option value="">— none —</option>
                              {roomRatePlans.map((rp) => (
                                <option key={rp.id} value={rp.id}>
                                  {rp.mealPlan ? `${rp.name} (${rp.mealPlan})` : rp.name}
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* §user request — "Base Price" column, still the same ratePerNight field
                              (per the active GST mode), just styled as a compact editable pill with
                              a pencil hint instead of a full labelled Field block. */}
                          <div className="w-28">
                            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Base Price</p>
                            <div className="relative">
                              <input
                                disabled={isEditMode}
                                title={isEditMode ? 'The agreed rate is locked once a reservation exists — use Discount or an add-on charge instead' : undefined}
                                className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-2.5 pr-6 text-sm font-semibold text-slate-900 outline-none focus:border-brand-400 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:disabled:bg-slate-900/60"
                                type="number"
                                min={0}
                                value={p.ratePerNight}
                                onChange={(e) => updateRate(p.room.id, Number(e.target.value))}
                              />
                              {!isEditMode && (
                                <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-300 dark:text-slate-600">✎</span>
                              )}
                            </div>
                          </div>

                          {/* §user request — "+ icon jisme hum room ADD ON ke extra charges le sake, jaise extra
                              mattress and others": same InvoiceLineItem mechanism check-in's "+ Add Extra Charges"
                              already uses, one line-item list per room. */}
                          <button
                            type="button"
                            onClick={() => setAddingChargeFor(addingChargeFor === p.room.id ? null : p.room.id)}
                            title="Add-on / extra charge"
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-base font-bold text-brand-600 hover:border-brand-400 hover:bg-brand-50/40 dark:border-slate-600 dark:text-brand-400 dark:hover:bg-brand-500/10"
                          >
                            +
                          </button>
                          <button
                            type="button"
                            onClick={() => removeRoom(p.room.id)}
                            title="Remove room"
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-red-500 hover:bg-red-50 dark:border-slate-600 dark:hover:bg-red-500/10"
                          >
                            🗑
                          </button>
                        </div>
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-2 sm:pl-[52px]">
                        {/* §user request — bulk/wedding reservations can need different dates per room; this
                            chip defaults to the reservation's own dates and only diverges when edited. */}
                        <button
                          type="button"
                          onClick={() => setEditingDatesFor(editingDatesFor === p.room.id ? null : p.room.id)}
                          className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
                        >
                          📅 {formatDateShort(p.checkIn || checkIn)} – {formatDateShort(p.checkOut || checkOut)} · {p.roomStayNights} night{p.roomStayNights === 1 ? '' : 's'}
                          {hasCustomDates && <span className="text-brand-600 dark:text-brand-400">(custom)</span>}
                        </button>
                        <span className="text-[11px] text-slate-400 dark:text-slate-500">
                          ₹{p.ratePerNight || 0} × {p.roomStayNights} night{p.roomStayNights === 1 ? '' : 's'} ={' '}
                          <span className="font-semibold text-slate-600 dark:text-slate-300">₹{p.totalAmount.toFixed(2)}</span>
                        </span>
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

                      {/* §user request — "ye Add wala bar hatao, side mein + wala button daalo,
                          same UX/UI jaisa ss mein diya": one single row (description, qty
                          stepper, price, a small round + to submit, a plain ✕ to cancel) instead
                          of a stacked form with a full-width Add button. */}
                      {addingChargeFor === p.room.id && (
                        <form onSubmit={(e) => addCharge(e, p.room.id)} className="mt-2.5 flex flex-wrap items-center gap-2">
                          <input
                            className="min-w-[160px] flex-1 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm italic text-slate-900 outline-none placeholder:text-slate-400 focus:border-brand-400 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                            placeholder="Eg.   Extra Mattress"
                            value={chargeDesc}
                            onChange={(e) => setChargeDesc(e.target.value)}
                            required
                            autoFocus
                          />
                          <div className="flex shrink-0 items-center gap-3 rounded-full border border-slate-200 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800">
                            <button
                              type="button"
                              onClick={() => setChargeQty((q) => Math.max(1, (q === '' ? 1 : q) - 1))}
                              className="text-lg font-bold leading-none text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                            >
                              −
                            </button>
                            <span className="text-sm font-semibold text-slate-900 dark:text-white">{chargeQty === '' ? 1 : chargeQty}</span>
                            <button
                              type="button"
                              onClick={() => setChargeQty((q) => (q === '' ? 1 : q) + 1)}
                              className="text-lg font-bold leading-none text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                            >
                              +
                            </button>
                          </div>
                          <input
                            className="w-28 shrink-0 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm italic text-slate-900 outline-none placeholder:text-slate-400 focus:border-brand-400 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                            type="number"
                            placeholder="Price"
                            value={chargeUnitPrice}
                            onChange={(e) => setChargeUnitPrice(e.target.value === '' ? '' : Number(e.target.value))}
                            min={0}
                          />
                          <button
                            type="submit"
                            title="Add charge"
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 text-lg font-bold text-brand-600 hover:border-brand-400 hover:bg-brand-50/40 dark:border-slate-600 dark:text-brand-400 dark:hover:bg-brand-500/10"
                          >
                            +
                          </button>
                          <button
                            type="button"
                            onClick={() => setAddingChargeFor(null)}
                            title="Cancel"
                            className="shrink-0 px-1 text-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                          >
                            ✕
                          </button>
                        </form>
                      )}
                    </div>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={openPicker}
                disabled={loadingRooms}
                className="mt-2.5 w-full rounded-xl border border-dashed border-slate-300 py-3 text-sm font-semibold text-brand-600 hover:border-brand-400 hover:bg-brand-50/40 disabled:opacity-50 dark:border-slate-600 dark:text-brand-400 dark:hover:bg-brand-500/10"
              >
                {loadingRooms ? 'Loading rooms…' : '+ Add Room'}
              </button>
            </Card>

            {picked.length > 0 && (
              <Card className="order-4 p-4">
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">Pricing &amp; Discount</p>
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

                {/* lg+ screens show this same breakdown inside the sticky Booking Summary
                    sidebar instead — kept here (hidden on lg+) so phones/tablets, which stack the
                    sidebar below everything else, still see it right next to the controls that
                    produce it. */}
                <div className="mt-3 space-y-1.5 rounded-xl border border-slate-200 p-3.5 text-sm dark:border-slate-700 lg:hidden">
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
              </Card>
            )}

            {/* Edit mode never records a new payment through this form — that's Add Payment's
                job, kept untouched so the group's existing ledger isn't duplicated. */}
            {!isEditMode && (
              <Card className="order-5 p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-sm dark:bg-brand-500/10">💳</span>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wide text-slate-700 dark:text-slate-200">Payment Advance</p>
                      <p className="text-[11px] text-slate-400 dark:text-slate-500">Enter the payment details.</p>
                    </div>
                  </div>
                  {/* §user request — "+Add Payment ka option which is agar kisi ne cash and UPI
                      dono diya toh hum dono add kar sakein": each row is its own mode + amount +
                      optional reference, summed into one advanceAmount for the totals above and
                      sent to the API as separate ledger entries (see payments[] on submit). */}
                  <button
                    type="button"
                    onClick={addPaymentRow}
                    className="shrink-0 rounded-lg border border-dashed border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-brand-600 hover:border-brand-400 hover:bg-brand-50/40 dark:border-slate-600 dark:text-brand-400 dark:hover:bg-brand-500/10"
                  >
                    + Add Payment
                  </button>
                </div>
                <div className="space-y-2.5">
                  {paymentRows.map((row) => (
                    <div key={row.key} className="relative rounded-lg bg-slate-50 p-2.5 dark:bg-slate-900/40">
                      {paymentRows.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removePaymentRow(row.key)}
                          className="absolute right-1.5 top-1.5 text-red-500 hover:text-red-700 dark:text-red-400"
                          aria-label="Remove payment"
                        >
                          ✕
                        </button>
                      )}
                      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                        <Field label="Payment Mode">
                          <Combobox
                            value={row.method}
                            options={PAYMENT_METHOD_OPTIONS}
                            onChange={(m) => updatePaymentRow(row.key, { method: m })}
                          />
                        </Field>
                        <Field label="Amount (₹)">
                          <input
                            className={inputClass}
                            type="number"
                            min={0}
                            max={grandTotal}
                            value={row.amount}
                            onChange={(e) => updatePaymentRow(row.key, { amount: e.target.value === '' ? '' : Number(e.target.value) })}
                          />
                        </Field>
                      </div>
                      <div className="mt-2.5">
                        <Field label="Reference ID (optional)">
                          <input
                            className={inputClass}
                            value={row.referenceNumber}
                            onChange={(e) => updatePaymentRow(row.key, { referenceNumber: e.target.value })}
                            placeholder="e.g. UTR / transaction ID"
                          />
                        </Field>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}
            </div>

            {/* §user request — "jo booking summary mein colour aur spacing hai vese hi apne mein
                banao": a reference app's own white-card summary (icon+label stat tiles, per-
                category Room Charges with their own GST/Subtotal lines, dashed dividers before
                Grand Total and Balance Payable, red Balance Payable) rebuilt in our brand colors.
                Per-category GST below applies the SAME blended rate the real Grand Total already
                uses (totals.gst.rate) rather than an independent per-category slab, so these
                lines always foot to the one real total below instead of risking a mismatch. */}
            <aside className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 lg:sticky lg:top-0 lg:self-start">
              <p className="border-b border-slate-100 pb-3 text-sm font-bold text-slate-900 dark:border-slate-700 dark:text-white">Booking Summary</p>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-base dark:bg-brand-500/10">📅</span>
                  <div className="min-w-0">
                    <p className="text-[11px] text-slate-400 dark:text-slate-500">Check-in</p>
                    <p className="truncate text-sm font-bold text-slate-900 dark:text-white">{formatDateShort(checkIn)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-base dark:bg-brand-500/10">📅</span>
                  <div className="min-w-0">
                    <p className="text-[11px] text-slate-400 dark:text-slate-500">Check-out</p>
                    <p className="truncate text-sm font-bold text-slate-900 dark:text-white">{formatDateShort(checkOut)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-base dark:bg-brand-500/10">🌙</span>
                  <div className="min-w-0">
                    <p className="text-[11px] text-slate-400 dark:text-slate-500">Nights</p>
                    <p className="text-sm font-bold text-slate-900 dark:text-white">{String(nights).padStart(2, '0')}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-base dark:bg-brand-500/10">🚪</span>
                  <div className="min-w-0">
                    <p className="text-[11px] text-slate-400 dark:text-slate-500">Rooms</p>
                    <p className="text-sm font-bold text-slate-900 dark:text-white">{String(picked.length).padStart(2, '0')}</p>
                  </div>
                </div>
              </div>

              {picked.length > 0 && (
                <div className="space-y-3 border-t border-slate-100 pt-3 dark:border-slate-700">
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Room Charges</p>
                  {roomChargesByCategory.map((c, i) => {
                    const categoryGst = Math.round((c.amount * totals.gst.rate) / 100);
                    const avgRate = nights > 0 && c.count > 0 ? Math.round(c.amount / c.count / nights) : c.amount;
                    return (
                      <div key={c.name} className={i > 0 ? 'border-t border-dashed border-slate-200 pt-3 dark:border-slate-700' : ''}>
                        <div className="flex justify-between text-sm font-bold text-slate-900 dark:text-white">
                          <span>{c.name}</span>
                          <span>₹{(c.amount + categoryGst).toFixed(0)}</span>
                        </div>
                        <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
                          ₹{avgRate.toLocaleString('en-IN')} × {c.count} Room{c.count === 1 ? '' : 's'} × {nights} Night{nights === 1 ? '' : 's'}
                        </p>
                        <div className="mt-1.5 flex justify-between text-sm text-slate-400 dark:text-slate-500">
                          <span>GST ({totals.gst.rate}%)</span>
                          <span>₹{categoryGst.toFixed(0)}</span>
                        </div>
                        <div className="flex justify-between text-sm text-slate-400 dark:text-slate-500">
                          <span>Subtotal</span>
                          <span>₹{(c.amount + categoryGst).toFixed(0)}</span>
                        </div>
                      </div>
                    );
                  })}

                  <div className="space-y-1 border-t border-slate-100 pt-3 dark:border-slate-700">
                    <div className="flex justify-between text-sm font-bold text-slate-900 dark:text-white">
                      <span>Room Charges</span>
                      <span>₹{baseTotal.toFixed(0)}</span>
                    </div>
                    {totals.extraCharges > 0 && (
                      <div className="flex justify-between text-sm font-bold text-slate-900 dark:text-white">
                        <span>Add-ons</span>
                        <span>₹{totals.extraCharges.toFixed(0)}</span>
                      </div>
                    )}
                    {totals.discount > 0 && (
                      <div className="flex justify-between text-sm font-semibold text-amber-600 dark:text-amber-400">
                        <span>Discount</span>
                        <span>−₹{totals.discount.toFixed(0)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm font-bold text-slate-900 dark:text-white">
                      <span>GST</span>
                      <span>₹{totals.gst.amount.toFixed(0)}</span>
                    </div>
                  </div>

                  <div className="border-t border-dashed border-slate-200 pt-3 dark:border-slate-700">
                    <div className="flex justify-between text-base font-bold text-slate-900 dark:text-white">
                      <span>Grand Total</span>
                      <span>₹{grandTotal.toFixed(0)}</span>
                    </div>
                  </div>

                  {/* §user request — "byfercate this in very small cash and mode of payment in
                      italic and very small": Advance Received broken down per mode (Cash ₹2000,
                      UPI ₹3000, …) right under the combined figure, instead of just one lump sum. */}
                  {!isEditMode && advanceAmount > 0 && (
                    <div className="flex justify-between text-sm font-semibold text-green-600 dark:text-green-400">
                      <span>Advance Received</span>
                      <span>−₹{advanceAmount.toFixed(0)}</span>
                    </div>
                  )}
                  {!isEditMode &&
                    paymentRows
                      .filter((r) => r.amount !== '' && r.amount > 0)
                      .map((r) => (
                        <div key={r.key} className="flex justify-between pl-2 text-[11px] italic text-slate-400 dark:text-slate-500">
                          <span>{PAYMENT_METHOD_OPTIONS.find((o) => o.value === r.method)?.label ?? r.method}</span>
                          <span>₹{(r.amount as number).toFixed(0)}</span>
                        </div>
                      ))}
                  {isEditMode && alreadyPaid > 0 && (
                    <div className="flex justify-between text-sm font-semibold text-green-600 dark:text-green-400">
                      <span>Advance Received</span>
                      <span>−₹{alreadyPaid.toFixed(0)}</span>
                    </div>
                  )}

                  <div className="border-t border-dashed border-slate-200 pt-3 dark:border-slate-700">
                    <div className="flex justify-between text-base font-bold">
                      <span className="text-slate-900 dark:text-white">Balance Payable</span>
                      <span className="text-red-500 dark:text-red-400">₹{due.toFixed(0)}</span>
                    </div>
                  </div>
                </div>
              )}

              <Button type="button" onClick={submit} disabled={submitting || picked.length === 0} className="w-full">
                {isEditMode ? (submitting ? 'Saving…' : 'Save Changes') : submitting ? 'Creating…' : 'Create Reservation'}
              </Button>
            </aside>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-4 dark:border-slate-700 lg:hidden">
            <div className="text-sm">
              <span className="font-bold text-amber-600 dark:text-amber-400">₹{due.toFixed(2)}</span>
              <span className="text-slate-400 dark:text-slate-500"> due of ₹{grandTotal.toFixed(2)}{isEditMode && alreadyPaid > 0 ? ` (₹${alreadyPaid.toFixed(2)} already paid)` : ''}</span>
            </div>
            <Button type="button" onClick={submit} disabled={submitting || picked.length === 0}>
              {isEditMode ? (submitting ? 'Saving…' : 'Save Changes') : submitting ? 'Creating…' : 'Create Reservation'}
            </Button>
          </div>
        </Card>

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

      {stayPickerOpen && (
        <StayDateRangeModal
          checkIn={checkIn}
          checkOut={checkOut}
          onApply={(ci, co) => {
            setCheckIn(ci);
            setCheckOut(co);
            setStayPickerOpen(false);
          }}
          onClose={() => setStayPickerOpen(false)}
        />
      )}

      {successData && (
        <ReservationSuccessModal
          data={successData}
          onClose={() => {
            setSuccessData(null);
            onDone();
          }}
        />
      )}
    </div>
  );
}

const STAY_WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const STAY_MONTH_LABELS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** §user request, with a reference app's own "Select stay dates" calendar as the target — unlike
 * Check-in's walk-in version (check-in day fixed to today), a reservation's check-in is also
 * pickable: first tap sets check-in and clears check-out, the next later tap sets check-out —
 * same two-tap range convention, just with both ends open. */
function StayDateRangeModal({
  checkIn,
  checkOut,
  onApply,
  onClose,
}: {
  checkIn: string;
  checkOut: string;
  onApply: (checkIn: string, checkOut: string) => void;
  onClose: () => void;
}) {
  const [draftCheckIn, setDraftCheckIn] = useState(checkIn);
  const [draftCheckOut, setDraftCheckOut] = useState<string | null>(checkOut);
  // §user request, with a reference app's own two-tap range calendar as the target — true after a
  // check-in-only tap, false once a complete range exists (including the initial one this modal
  // opens with). The NEXT tap behaves differently depending on which state we're in: mid-selection
  // it completes the range as check-out, otherwise it starts a fresh selection — see pickDay below.
  const [awaitingCheckout, setAwaitingCheckout] = useState(false);
  // Live range-fill preview while awaitingCheckout, following the pointer before the check-out tap
  // actually lands — "26 pe drag ho toh animation aa jaaye" (hover across days towards 26 should
  // fill the range live, the way the reference app's own calendar does).
  const [hoverDate, setHoverDate] = useState<string | null>(null);
  const [viewDate, setViewDate] = useState(() => {
    const [y, m] = checkIn.split('-').map(Number);
    return { year: y, month: m - 1 };
  });

  const nights = draftCheckOut
    ? Math.max(1, Math.round((new Date(`${draftCheckOut}T00:00:00`).getTime() - new Date(`${draftCheckIn}T00:00:00`).getTime()) / 86400000))
    : 0;

  const firstWeekday = new Date(viewDate.year, viewDate.month, 1).getDay();
  const daysInMonth = new Date(viewDate.year, viewDate.month + 1, 0).getDate();
  const cells: (string | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => `${viewDate.year}-${String(viewDate.month + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`),
  ];

  function changeMonth(delta: number) {
    setViewDate((v) => {
      const m = v.month + delta;
      return { year: v.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 };
    });
  }

  // §user request — "26 pe single click karte hi dates select ho jaaye, aur agar single click
  // karu 26 pe toh automatically wo date check-in aa jaaye": a tap either completes a pending
  // selection (awaitingCheckout, tapping a later day) or starts a brand-new one — never silently
  // adjusts an already-complete range's check-out the way a plain "iso <= checkIn" check would.
  function pickDay(iso: string) {
    if (awaitingCheckout && iso > draftCheckIn) {
      setDraftCheckOut(iso);
      setAwaitingCheckout(false);
    } else {
      setDraftCheckIn(iso);
      setDraftCheckOut(null);
      setAwaitingCheckout(true);
    }
    setHoverDate(null);
  }

  return createPortal(
    <div className="fixed inset-0 z-[66] flex items-center justify-center bg-slate-900/60 p-4">
      <div className="flex max-h-[90vh] w-full max-w-sm flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-800">
        <div className="flex shrink-0 items-start justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-700">
          <div>
            <h4 className="text-base font-bold text-slate-900 dark:text-white">Select stay dates</h4>
            <p className="text-xs text-slate-500 dark:text-slate-400">Choose your check-in and check-out dates</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-4 flex items-center justify-between rounded-xl bg-[#F5F7FA] px-3 py-2.5 dark:bg-slate-900/40">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-400">Check In</p>
              <p className="text-sm font-bold text-slate-900 dark:text-white">{formatDateShort(draftCheckIn)}</p>
            </div>
            <span className="rounded-full bg-brand-600 px-2.5 py-1 text-xs font-bold text-white shadow-sm">{nights} N</span>
            <div className="text-right">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-400">Check Out</p>
              <p className="text-sm font-bold text-slate-900 dark:text-white">{draftCheckOut ? formatDateShort(draftCheckOut) : '—'}</p>
            </div>
          </div>

          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-bold text-slate-900 dark:text-white">
              {STAY_MONTH_LABELS[viewDate.month]} {viewDate.year}
            </p>
            <div className="flex gap-1">
              <button type="button" onClick={() => changeMonth(-1)} className="flex h-7 w-7 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700">
                ‹
              </button>
              <button type="button" onClick={() => changeMonth(1)} className="flex h-7 w-7 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700">
                ›
              </button>
            </div>
          </div>

          <div className="mb-1 grid grid-cols-7 gap-1 text-center text-xs font-semibold text-slate-400">
            {STAY_WEEKDAY_LABELS.map((d) => (
              <div key={d}>{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1" onMouseLeave={() => setHoverDate(null)}>
            {cells.map((iso, i) => {
              if (!iso) return <div key={`blank-${i}`} />;
              const isCheckIn = iso === draftCheckIn;
              const isCheckOut = !awaitingCheckout && iso === draftCheckOut;
              const previewEnd = awaitingCheckout && hoverDate && hoverDate > draftCheckIn ? hoverDate : null;
              const rangeEnd = previewEnd ?? (!awaitingCheckout ? draftCheckOut : null);
              const inRange = Boolean(rangeEnd) && iso > draftCheckIn && iso <= (rangeEnd as string) && !isCheckOut;
              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => pickDay(iso)}
                  onMouseEnter={() => awaitingCheckout && setHoverDate(iso)}
                  className={`flex h-9 items-center justify-center text-sm transition-colors ${
                    isCheckIn || isCheckOut
                      ? 'rounded-full bg-brand-600 font-bold text-white'
                      : inRange
                        ? 'rounded-md bg-brand-50 text-slate-900 dark:bg-brand-500/10 dark:text-white'
                        : 'rounded-full text-slate-700 hover:bg-brand-50 dark:text-slate-300 dark:hover:bg-brand-500/10'
                  }`}
                >
                  {Number(iso.slice(-2))}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex shrink-0 gap-2 border-t border-slate-100 px-5 py-4 dark:border-slate-700">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            className="flex-1"
            disabled={!draftCheckOut}
            onClick={() => draftCheckOut && onApply(draftCheckIn, draftCheckOut)}
          >
            Apply dates · {nights} night{nights === 1 ? '' : 's'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
