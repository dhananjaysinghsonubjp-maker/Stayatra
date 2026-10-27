import { useEffect, useMemo, useRef, useState } from 'react';
import { mutate, query, uploadFiles, ApiError } from '../../api';
import { useAuth } from '../../AuthContext';
import { Button, Card, Field, royalInputClass as inputClass } from '../../components/ui';
import { computeGstSlab } from '../../gst';
import { formatDateTimeShort } from '../../dateFormat';
import { CameraCapture } from './CameraCapture';
import { InvoiceStep, type InvoiceDraft } from './InvoiceStep';
import type { Booking, Gender, Guest, IdType, RatePlan, Room } from '../../types';

const ID_TYPES: { value: IdType; label: string }[] = [
  { value: 'aadhaar', label: 'Aadhaar' },
  { value: 'passport', label: 'Passport' },
  { value: 'driving_license', label: 'Driving License' },
  { value: 'voter_id', label: 'Voter ID' },
  { value: 'other', label: 'Other' },
];

const TITLES = ['Mr', 'Mrs', 'Ms', 'Dr', 'Other'];

const PURPOSES = ['Leisure', 'Business', 'Medical', 'Event/Wedding', 'Other'];

function isAdult(dob: string): boolean {
  const birth = new Date(dob);
  const eighteenYearsAgo = new Date();
  eighteenYearsAgo.setFullYear(eighteenYearsAgo.getFullYear() - 18);
  return birth <= eighteenYearsAgo;
}

interface Props {
  hotelId: string;
  /** Opened from Room Board — room is fixed, guest can be new or picked from an existing reservation. */
  room?: Room;
  /** Opened from Reservations — reservation is fixed, a physical room still needs to be assigned
   * (unless reservation.assignedRoomId is already set — a multi-room reservation picks its rooms
   * upfront, see createMultiRoomReservation — in which case this is just its display label). */
  reservation?: Booking;
  assignedRoomNumber?: string;
  onClose: () => void;
  onDone: () => void;
}

export function CheckInModal({ hotelId, room, reservation, assignedRoomNumber, onClose, onDone }: Props) {
  const { token } = useAuth();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [mode, setMode] = useState<'new' | 'existing'>(reservation ? 'existing' : 'new');
  // §user request, reference app's own post-check-in screen — a brief confirmation instead of
  // the modal just vanishing, so the front desk gets a clear "done" moment with what just
  // happened (which room, what time) before moving on.
  const [successInfo, setSuccessInfo] = useState<{ roomNumber: string; checkedInAt: Date } | null>(null);
  const [successCountdown, setSuccessCountdown] = useState(4);

  // guest identity
  const [guestId, setGuestId] = useState<string | undefined>(undefined);
  const [title, setTitle] = useState('Mr');
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [email, setEmail] = useState('');
  const [gender, setGender] = useState<Gender | ''>('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [address, setAddress] = useState('');
  const [country, setCountry] = useState('India');
  const [state, setState] = useState('');
  const [city, setCity] = useState('');
  const [pincode, setPincode] = useState('');
  const [purposeOfStay, setPurposeOfStay] = useState('');
  // §user request — "corporate booking vala nahi dala hai", then "poora company details daalne
  // ka option" with a reference app's own Individual/Company toggle as the target: bills the
  // stay to a company (for their GST input credit) right at check-in, same billToCompany* fields
  // the invoice view's own "Bill to company" already writes later.
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
  const [idType, setIdType] = useState<IdType>('aadhaar');
  const [idNumber, setIdNumber] = useState('');
  const [idPhotoPath, setIdPhotoPath] = useState<string | undefined>(undefined);
  const [idPhotoBackPath, setIdPhotoBackPath] = useState<string | undefined>(undefined);

  // guest search / autofill
  const [matches, setMatches] = useState<Guest[]>([]);
  const [searching, setSearching] = useState(false);

  // §user request — "front and back dono upload, AI dono se saari details (naam, gender, DOB,
  // address, state, pincode, country, aadhaar number) fill kare, bas phone number hum khud type
  // karenge": one upload slot per side, re-running extraction across whatever side(s) are
  // present each time a new one is added (so front-only still autofills immediately, and adding
  // back later refines/fills in the rest — address especially, which Aadhaar prints on the back).
  const frontInputRef = useRef<HTMLInputElement>(null);
  const backInputRef = useRef<HTMLInputElement>(null);
  const [frontFile, setFrontFile] = useState<File | null>(null);
  const [backFile, setBackFile] = useState<File | null>(null);
  // §user request — "upload hone ke baad picture bani aani chahiye ki kya upload hui hai": a
  // local thumbnail of whatever was just picked/captured, independent of the server upload.
  const frontPreview = useMemo(() => (frontFile ? URL.createObjectURL(frontFile) : null), [frontFile]);
  const backPreview = useMemo(() => (backFile ? URL.createObjectURL(backFile) : null), [backFile]);
  useEffect(() => () => { if (frontPreview) URL.revokeObjectURL(frontPreview); }, [frontPreview]);
  useEffect(() => () => { if (backPreview) URL.revokeObjectURL(backPreview); }, [backPreview]);
  // §user request — "upload bhi ho sake aur real-time image bhi click kar sake, ye add-on zaroor
  // chahiye": which side's live-camera viewfinder (CameraCapture) is currently open, if any.
  const [cameraFor, setCameraFor] = useState<'front' | 'back' | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanNotice, setScanNotice] = useState<string | null>(null);

  // stay / rate
  const [ratePlans, setRatePlans] = useState<RatePlan[]>([]);
  const [ratePlanId, setRatePlanId] = useState('');
  const [amountPerNight, setAmountPerNight] = useState(2000);
  const [nights, setNights] = useState(1);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // §user request, with a reference app's own slide-over as the target, matching Create
  // Reservation's own treatment — right-side panel on desktop (bottom sheet on phone), sliding
  // in smoothly instead of just appearing.
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

  // existing-reservation mode
  const [upcoming, setUpcoming] = useState<Booking[]>([]);
  const [selectedReservationId, setSelectedReservationId] = useState(reservation?.id ?? '');
  const [availableRooms, setAvailableRooms] = useState<Room[]>([]);
  // §user request — a multi-room reservation already has its specific room picked at booking
  // time (bookings.service.ts createMultiRoomReservation), not just a category — check-in
  // shouldn't re-prompt the front desk to choose one, just use it.
  const [selectedRoomId, setSelectedRoomId] = useState(reservation?.assignedRoomId ?? room?.id ?? '');

  // §user request — "guest ek din pehle aa jaata hai, dates adjust karne de check-in ke time hi":
  // an existing reservation's stay dates used to be fixed at booking time with no way to correct
  // them until after check-in (Edit Stay, and only within its 1-hour window). These are editable
  // right here now, same as the "new guest" rate/nights fields below, so an early/late arrival is
  // handled in the same step as check-in instead of a rushed follow-up edit.
  const [stayCheckIn, setStayCheckIn] = useState('');
  const [stayCheckOut, setStayCheckOut] = useState('');

  const selectedReservation = reservation ?? upcoming.find((r) => r.id === selectedReservationId) ?? null;
  const roomCategoryId = room?.roomCategoryId ?? selectedReservation?.roomCategoryId;
  const existingNights =
    stayCheckIn && stayCheckOut ? Math.max(1, Math.round((new Date(stayCheckOut).getTime() - new Date(stayCheckIn).getTime()) / 86400000)) : 0;
  const totalAmount = mode === 'new' ? amountPerNight * nights : amountPerNight * existingNights;
  const datesChanged =
    mode === 'existing' && selectedReservation && (stayCheckIn !== selectedReservation.checkIn.slice(0, 10) || stayCheckOut !== selectedReservation.checkOut.slice(0, 10));
  const gst = computeGstSlab(totalAmount);

  // §user request — "bulk booking me ek hi naam sab rooms pe hota hai, check-in ke time us
  // particular room ka actual guest pata hona chahiye": a multi-room reservation (Calendar's
  // createMultiRoomReservation) shares one guestName across every room at booking time — there's
  // no per-room guest yet. For an ordinary single-room reservation, prefilling from the booking
  // is still right (there's only one guest, correcting a typo is the only reason to touch it).
  // For a *group* booking (bookedByName set — "Neeraj ji ne 5 room book kiye"), the shared name
  // is the booker, not this room's actual occupant, so this starts blank instead — "Booked by"
  // stays visible separately (below) for context while the front desk types who's really here.
  useEffect(() => {
    if (mode !== 'existing' || !selectedReservation) return;
    setGuestName(selectedReservation.bookedByName ? '' : selectedReservation.guestName);
    setGuestPhone(selectedReservation.bookedByName ? '' : (selectedReservation.guestPhone ?? ''));
    setStayCheckIn(selectedReservation.checkIn.slice(0, 10));
    setStayCheckOut(selectedReservation.checkOut.slice(0, 10));
    setAmountPerNight(Math.round(Number(selectedReservation.totalAmount) / Math.max(1, selectedReservation.nights)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedReservation?.id, mode]);

  useEffect(() => {
    if (mode !== 'existing' || reservation) return;
    query<Booking[]>('bookings.listUpcomingReservations', { hotelId, roomCategoryId: room?.roomCategoryId }, token ?? undefined).then(setUpcoming);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, hotelId]);

  useEffect(() => {
    if (!reservation || reservation.assignedRoomId) return;
    query<Room[]>('hotels.listRooms', { hotelId }, token ?? undefined).then((rooms) =>
      setAvailableRooms(rooms.filter((r) => r.status === 'available' && r.roomCategoryId === reservation.roomCategoryId)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reservation, hotelId]);

  useEffect(() => {
    if (!roomCategoryId) {
      setRatePlans([]);
      return;
    }
    query<RatePlan[]>('rates.listRatePlans', { roomCategoryId }, token ?? undefined).then(setRatePlans);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCategoryId]);

  // §bugfix — calling onDone() the moment check-in succeeds (while still showing the success
  // screen) used to immediately unmount this modal when opened from ReservationDetailModal: its
  // onDone also clears the "which booking is being checked in" state that this component's own
  // render is conditional on, so the success screen never actually painted. onDone/onClose now
  // both fire together, only once the success screen is actually dismissed.
  function finish() {
    onDone();
    onClose();
  }

  // Auto-dismiss the success screen after a few seconds, matching the reference app's own
  // countdown — the front desk doesn't have to click anything if they're ready to move on.
  useEffect(() => {
    if (step !== 3) return;
    setSuccessCountdown(4);
    const id = setInterval(() => {
      setSuccessCountdown((n) => {
        if (n <= 1) {
          clearInterval(id);
          finish();
          return 0;
        }
        return n - 1;
      });
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // guest search-as-you-type once a full 10-digit phone is entered
  useEffect(() => {
    if (mode !== 'new' || !/^\d{10}$/.test(guestPhone)) {
      setMatches([]);
      return;
    }
    setSearching(true);
    const id = setTimeout(() => {
      query<Guest[]>('guests.search', { hotelId, phone: guestPhone }, token ?? undefined)
        .then(setMatches)
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guestPhone, mode]);

  function applyGuest(g: Guest) {
    setGuestId(g.id);
    setTitle(g.title ?? 'Mr');
    setGuestName(g.name);
    setGuestPhone(g.phone);
    setEmail(g.email ?? '');
    setGender(g.gender ?? '');
    setDateOfBirth(g.dateOfBirth?.slice(0, 10) ?? '');
    setAddress(g.address ?? '');
    setCountry(g.country ?? 'India');
    setState(g.state ?? '');
    setCity(g.city ?? '');
    setPincode(g.pincode ?? '');
    if (g.idType) setIdType(g.idType);
    if (g.idNumber) setIdNumber(g.idNumber);
    setMatches([]);
  }

  async function handleAiCheckIn(side: 'front' | 'back', file: File) {
    const nextFront = side === 'front' ? file : frontFile;
    const nextBack = side === 'back' ? file : backFile;
    if (side === 'front') setFrontFile(file);
    else setBackFile(file);
    if (!nextFront) return; // back uploaded before front — nothing to scan yet

    setScanning(true);
    setScanNotice(null);
    setError(null);
    try {
      const files: Record<string, File> = { front: nextFront };
      if (nextBack) files.back = nextBack;
      const result = await uploadFiles<{ filePath: string; backFilePath?: string; extracted: Record<string, string> & { confidence: string } }>(
        'uploads/id-scan',
        files,
        token ?? undefined,
      );
      const { extracted, filePath, backFilePath } = result;
      setIdPhotoPath(filePath);
      if (backFilePath) setIdPhotoBackPath(backFilePath);
      if (extracted.name) setGuestName(extracted.name);
      if (extracted.gender) setGender(extracted.gender as Gender);
      if (extracted.dateOfBirth) setDateOfBirth(extracted.dateOfBirth);
      if (extracted.address) setAddress(extracted.address);
      if (extracted.country) setCountry(extracted.country);
      if (extracted.state) setState(extracted.state);
      if (extracted.city) setCity(extracted.city);
      if (extracted.pincode) setPincode(extracted.pincode);
      if (extracted.idType) setIdType(extracted.idType as IdType);
      if (extracted.idNumber) setIdNumber(extracted.idNumber);
      setScanNotice(
        extracted.confidence === 'stub'
          ? 'Scanned — this is simulated data (no ANTHROPIC_API_KEY configured yet). Fields below are placeholders, please verify.'
          : 'Scanned — please verify the extracted fields before submitting.',
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Scan failed');
    } finally {
      setScanning(false);
    }
  }

  /**
   * Pure validation + advance — nothing is saved until completeCheckIn (step
   * 2's "Complete Check-in"). The form has noValidate (see JSX below): every
   * constraint that used to live only as a `required`/`min`/`max` HTML
   * attribute silently intercepted submission before this handler ever ran,
   * making the matching custom error message below dead code and surfacing
   * an inconsistent native browser popup instead — so each one is
   * re-checked here explicitly.
   */
  function goToStepTwo(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!guestName.trim()) {
      setError('Full name is required');
      return;
    }
    if (guestPhone && !/^\d{10}$/.test(guestPhone)) {
      setError('Mobile number must be exactly 10 digits');
      return;
    }
    if (mode === 'new' && !purposeOfStay) {
      setError('Purpose of stay is required');
      return;
    }
    if (dateOfBirth && !isAdult(dateOfBirth)) {
      setError('Guest must be at least 18 years old');
      return;
    }
    if (mode === 'new' && (!Number.isInteger(nights) || nights < 1 || nights > 365)) {
      setError('Nights must be between 1 and 365');
      return;
    }
    if (!idNumber.trim()) {
      setError('ID number is required');
      return;
    }
    if (isCorporate && !companyName.trim()) {
      setError('Company name is required for a corporate booking');
      return;
    }
    if (mode === 'new' && !room) {
      setError('No room selected');
      return;
    }
    if (mode === 'existing' && !selectedReservation) {
      setError('Select a reservation');
      return;
    }
    if (mode === 'existing' && !(reservation ? selectedRoomId : room?.id)) {
      setError('Select a room');
      return;
    }
    if (mode === 'existing' && (!stayCheckIn || !stayCheckOut || stayCheckOut <= stayCheckIn)) {
      setError('Check-out must be after check-in');
      return;
    }

    setStep(2);
  }

  /** The one point where anything actually commits — everything from both steps bundled into a single mutation. */
  async function completeCheckIn(draft: InvoiceDraft) {
    setError(null);
    setBusy(true);
    try {
      // 'existing' mode prefills guestName/guestPhone from the reservation (see the effect
      // above) and now lets the front desk edit them — this room's actual occupant, not
      // necessarily the group reservation's original lead name — so both modes just send
      // whatever's currently in state.
      const guestDetails = {
        guestId,
        title,
        guestName,
        guestPhone: guestPhone || undefined,
        email: email || undefined,
        gender: gender || undefined,
        dateOfBirth: dateOfBirth || undefined,
        address: address || undefined,
        country: country || undefined,
        state: state || undefined,
        city: city || undefined,
        pincode: pincode || undefined,
        idType,
        idNumber,
        idPhotoPath,
        idPhotoBackPath,
        purposeOfStay: purposeOfStay || undefined,
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
      };
      const invoiceExtras = {
        lineItems: draft.lineItems.map((li) => ({ description: li.description, quantity: li.quantity, unitPrice: li.unitPrice })),
        discountAmount: draft.discountAmount ?? undefined,
        gstExempt: draft.gstExempt,
        payment: draft.payment,
      };

      let checkedInRoomNumber = '—';
      if (mode === 'new') {
        if (!room) throw new Error('No room selected');
        checkedInRoomNumber = room.roomNumber;
        const checkIn = new Date();
        const checkOut = new Date(Date.now() + nights * 86400000);
        await mutate(
          'bookings.checkInWalkIn',
          {
            hotelId,
            roomId: room.id,
            ...guestDetails,
            ratePlanId: ratePlanId || undefined,
            checkIn: checkIn.toISOString(),
            checkOut: checkOut.toISOString(),
            nights,
            totalAmount: draft.adjustedTotalAmount ?? totalAmount,
            ...invoiceExtras,
          },
          token ?? undefined,
        );
      } else {
        if (!selectedReservation) throw new Error('Select a reservation');
        const roomId = reservation ? selectedRoomId : (room?.id ?? '');
        if (!roomId) throw new Error('Select a room');
        checkedInRoomNumber = assignedRoomNumber ?? availableRooms.find((r) => r.id === roomId)?.roomNumber ?? room?.roomNumber ?? '—';
        await mutate(
          'bookings.checkInReservation',
          {
            bookingId: selectedReservation.id,
            roomId,
            ...guestDetails,
            checkIn: new Date(`${stayCheckIn}T00:00:00`).toISOString(),
            checkOut: new Date(`${stayCheckOut}T00:00:00`).toISOString(),
            nights: existingNights,
            totalAmount: draft.adjustedTotalAmount ?? totalAmount,
            ...invoiceExtras,
          },
          token ?? undefined,
        );
      }
      setSuccessInfo({ roomNumber: checkedInRoomNumber, checkedInAt: new Date() });
      setStep(3);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Check-in failed');
    } finally {
      setBusy(false);
    }
  }

  const title_ = room ? `Check in — ${room.roomNumber}` : selectedReservation ? `Check in — ${selectedReservation.guestName}` : 'Check in';
  const roomLabel =
    mode === 'new'
      ? room
        ? `${room.roomNumber}${room.roomCategory ? ` · ${room.roomCategory.name}` : ''}`
        : '—'
      : (assignedRoomNumber ?? room?.roomNumber ?? availableRooms.find((r) => r.id === selectedRoomId)?.roomNumber ?? 'Not assigned yet');

  return (
    // z-[60] — matches RoomPickerModal's precedent for a modal that must paint above another
    // z-50 modal (ReservationDetailModal nests this one; z-10 used to lose the stacking fight).
    // §user request, with a reference app's own slide-over as the target, matching Create
    // Reservation's own treatment — right-side panel on desktop, bottom sheet on phone, sliding
    // in smoothly instead of appearing instantly.
    <div className={`fixed inset-0 z-[60] overflow-y-auto bg-slate-900/40 transition-opacity duration-300 ${entered && !closing ? 'opacity-100' : 'opacity-0'}`}>
      {/* No click-outside-to-close here on purpose: this is a long, multi-step
          form (guest details + payment), and a stray click just past the
          card's edge used to silently discard everything typed so far with
          no confirmation. Leaving via "Cancel"/"Cancel check-in" is explicit. */}
      <Card
        className={`fixed inset-x-0 bottom-0 flex max-h-[92vh] w-full flex-col overflow-y-auto rounded-b-none rounded-t-2xl p-5 shadow-2xl transition-transform duration-300 ease-out sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-full sm:w-full sm:max-w-2xl sm:rounded-none ${
          entered && !closing ? 'translate-y-0 sm:translate-x-0' : 'translate-y-full sm:translate-y-0 sm:translate-x-full'
        }`}
      >
        {step !== 3 && (
          <div className="mb-4 flex items-center justify-between gap-2">
            <h4 className="min-w-0 truncate text-sm font-semibold text-slate-900">{title_}</h4>
            {/* §user request — "upar jo Suite likha hai vaha ek cross hona chahiye jo check in
                band karde, smoothly right-swipe hokar close ho": a close button in the slide-over's
                own header, same handleClose used by the Cancel button lower down. */}
            <button
              type="button"
              onClick={handleClose}
              aria-label="Close check-in"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            >
              ✕
            </button>
          </div>
        )}

        {/* §user request — "steps by room type ek particular box ho, properly section-wise": Room
            and Guest details (ID upload folded into the latter, not its own box) as separate cards. */}
        {step === 1 && (
          <>
            {room && !reservation && (
              <div className="mb-4 flex rounded-lg bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => setMode('new')}
                  className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${mode === 'new' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
                >
                  New guest
                </button>
                <button
                  type="button"
                  onClick={() => setMode('existing')}
                  className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${mode === 'existing' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
                >
                  Existing reservation
                </button>
              </div>
            )}

            {/* §bugfix — "bottom me buttons hide ho rahe the, niche tak nahi aa raha": this form
                used to cap its own height at 65vh with its own overflow-y-auto, nested inside the
                panel Card's own max-h-[92vh] overflow-y-auto — two independent scroll regions,
                the inner one hiding the Cancel/Next buttons past its own fixed cap regardless of
                how much room was actually left. A single scroll region (the Card's) is enough. */}
            <form onSubmit={goToStepTwo} noValidate className="space-y-4">
              {/* 1. Room — no picker here: the room is already fixed by which Room Board tile's
                  "Check in" was clicked (or already assigned at booking time); this just shows it
                  plus the price inputs, same fields a pick-a-room flow would ask for minus the
                  actual picking. */}
              <Card className="border-slate-200 p-4">
                <SectionHeader icon="🛏️" title="Room" />

                {mode === 'existing' && !reservation && (
                  <Field label="Reservation">
                    <select className={inputClass} value={selectedReservationId} onChange={(e) => setSelectedReservationId(e.target.value)} required>
                      <option value="">— select —</option>
                      {upcoming.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.guestName} · {r.checkIn.slice(0, 10)} → {r.checkOut.slice(0, 10)}
                        </option>
                      ))}
                    </select>
                    {upcoming.length === 0 && <p className="mt-1 text-xs text-slate-400">No upcoming reservations for this room category.</p>}
                  </Field>
                )}

                {(mode === 'new' || (mode === 'existing' && (reservation || selectedReservation))) && (
                  <div className="mb-3 mt-1 flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-base shadow-sm">🛏️</span>
                    <div className="min-w-0">
                      {mode === 'existing' && !reservation?.assignedRoomId ? (
                        <select className={`${inputClass} w-full`} value={selectedRoomId} onChange={(e) => setSelectedRoomId(e.target.value)} required>
                          <option value="">— select a room —</option>
                          {availableRooms.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.roomNumber}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <p className="truncate text-sm font-bold text-slate-900">{roomLabel}</p>
                      )}
                    </div>
                  </div>
                )}

                {mode === 'existing' && selectedReservation?.bookedByName && (
                  // §user request — "Neeraj ji ne booking karvayi hai, 102 mein koi aur guest aa
                  // raha hai — unka check-in form bhare": the booker stays visible as context
                  // while the name/details fields below start blank for this specific room.
                  <div className="mb-3 rounded-lg bg-brand-50 px-3 py-2 text-xs font-medium text-brand-700">
                    Booked by {selectedReservation.bookedByName} — fill this room's actual guest below.
                  </div>
                )}

                {mode === 'existing' && selectedReservation && (
                  <>
                    {/* §user request — "guest ek din pehle aa jaata hai, usi reservation me
                        check-in ke time hi dates adjust karne de": reserved for 24→26, guest
                        actually walks in on the 23rd and needs to leave the 25th — editable right
                        here instead of locked until a separate post-check-in Edit Stay. */}
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <Field label="Check-in">
                        <input className={inputClass} type="date" value={stayCheckIn} onChange={(e) => setStayCheckIn(e.target.value)} required />
                      </Field>
                      <Field label="Check-out">
                        <input className={inputClass} type="date" value={stayCheckOut} onChange={(e) => setStayCheckOut(e.target.value)} required />
                      </Field>
                      <Field label="Amount / night (₹)">
                        <input className={inputClass} type="number" value={amountPerNight} onChange={(e) => setAmountPerNight(Number(e.target.value))} min={0} />
                      </Field>
                      <Field label="Total">
                        <div className={`${inputClass} flex items-center bg-slate-50 font-medium text-slate-900`}>₹{totalAmount}</div>
                      </Field>
                    </div>
                    {datesChanged && (
                      <p className="mt-2 text-xs text-amber-600">
                        Reserved for {selectedReservation.checkIn.slice(0, 10)} → {selectedReservation.checkOut.slice(0, 10)} — adjusting to {stayCheckIn} →{' '}
                        {stayCheckOut} ({existingNights} night{existingNights === 1 ? '' : 's'}) on check-in.
                      </p>
                    )}
                    <p className="mt-2 text-xs text-slate-400">GST slab: {gst.label}</p>
                  </>
                )}

                {mode === 'new' && (
                  <>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <Field label="Meal plan">
                        <select className={inputClass} value={ratePlanId} onChange={(e) => setRatePlanId(e.target.value)}>
                          <option value="">— none —</option>
                          {ratePlans.map((rp) => (
                            <option key={rp.id} value={rp.id}>
                              {rp.mealPlan ? `${rp.name} (${rp.mealPlan})` : rp.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Amount / night (₹)">
                        <input className={inputClass} type="number" value={amountPerNight} onChange={(e) => setAmountPerNight(Number(e.target.value))} min={0} />
                      </Field>
                      <Field label="Nights">
                        <input className={inputClass} type="number" value={nights} onChange={(e) => setNights(Number(e.target.value))} min={1} max={365} />
                      </Field>
                      <Field label="Total">
                        <div className={`${inputClass} flex items-center bg-slate-50 font-medium text-slate-900`}>₹{totalAmount}</div>
                      </Field>
                    </div>
                    <p className="mt-2 text-xs text-slate-400">GST slab: {gst.label}</p>
                  </>
                )}
              </Card>

              {/* §user request — "reservation page ke through check-in karta hu toh poori guest
                  details nahi maangta, jaise walk-in ke maangta hai": this whole guest-capture
                  block used to be 'new'-mode only — every check-in needs the same real guest
                  record now, regardless of how the stay was booked. */}
              {(mode === 'new' || (mode === 'existing' && selectedReservation)) && (
                <>
                  {/* §user request — "ID upload vala feature alag se nahi, guest details mein hi
                      merge ho, jaise SS mein hai": folded into this one card instead of its own
                      "AI Check-in" box. */}
                  <Card className="border-slate-200 p-4">
                    <SectionHeader
                      icon="🧑"
                      title="Guest details"
                      action={
                        // §user request — "individual/company ka option guest details ke header
                        // pe ho, chhota aur clean, click karte hi niche company fields show
                        // honge": moved up from a full-width pill row near the bottom.
                        <div className="flex rounded-lg bg-slate-100 p-0.5 text-[11px]">
                          {(['individual', 'company'] as const).map((t) => (
                            <button
                              key={t}
                              type="button"
                              onClick={() => setGuestType(t)}
                              className={`rounded-md px-2.5 py-1 font-semibold transition-colors ${guestType === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
                            >
                              {t === 'company' ? '🏢 Company' : '👤 Individual'}
                            </button>
                          ))}
                        </div>
                      }
                    />

                    {/* §user request — "front and back dono upload, AI dono se saari details
                        (naam, gender, DOB, address, state, pincode, country, aadhaar number) fill
                        kare, bas phone number hum khud type karenge": re-scans on each side added. */}
                    <div className="mb-4 rounded-lg border border-dashed border-slate-300 bg-slate-50/60 p-3">
                      <p className="text-sm font-bold text-slate-900">Guest Identification (OCR)</p>
                      <p className="mb-3 text-xs text-slate-400">Upload a government-issued ID to automatically extract and fill guest details</p>
                      <div className="mb-3 flex flex-wrap gap-2">
                        {ID_TYPES.map((t) => (
                          <button
                            key={t.value}
                            type="button"
                            onClick={() => setIdType(t.value)}
                            className={`rounded-full px-3 py-1.5 text-xs font-medium ring-1 ring-inset transition-colors ${
                              idType === t.value ? 'bg-royal-600 text-white ring-royal-600' : 'bg-white text-slate-600 ring-slate-300 hover:bg-slate-50'
                            }`}
                          >
                            {t.label}
                          </button>
                        ))}
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <input
                          ref={frontInputRef}
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          className="hidden"
                          onChange={(e) => e.target.files?.[0] && handleAiCheckIn('front', e.target.files[0])}
                        />
                        <input
                          ref={backInputRef}
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          className="hidden"
                          onChange={(e) => e.target.files?.[0] && handleAiCheckIn('back', e.target.files[0])}
                        />
                        <IdPhotoSlot
                          label="Front side"
                          hint="JPG, PNG, WebP · max 5 MB"
                          previewUrl={frontPreview}
                          scanning={scanning}
                          onUpload={() => frontInputRef.current?.click()}
                          onCamera={() => setCameraFor('front')}
                          onRemove={() => setFrontFile(null)}
                        />
                        <IdPhotoSlot
                          label="Back side (optional)"
                          hint="Helps read the address"
                          previewUrl={backPreview}
                          scanning={scanning}
                          onUpload={() => backInputRef.current?.click()}
                          onCamera={() => setCameraFor('back')}
                          onRemove={() => setBackFile(null)}
                        />
                      </div>
                      {scanning && <p className="mt-2 text-xs text-royal-600">Scanning…</p>}
                      {scanNotice && <p className="mt-2 text-xs text-amber-600">{scanNotice}</p>}
                      <p className="mt-2 text-[11px] text-slate-400">Max 5 MB per side</p>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <Field label="Mobile number">
                          <div className="relative">
                            <input
                              className={`${inputClass} w-full`}
                              value={guestPhone}
                              onChange={(e) => {
                                setGuestPhone(e.target.value);
                                setGuestId(undefined);
                              }}
                              pattern="\d{10}"
                              placeholder="10-digit number"
                            />
                            {matches.length > 0 && (
                              <div className="absolute z-10 mt-1.5 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-md">
                                {matches.map((g) => (
                                  <button key={g.id} type="button" onClick={() => applyGuest(g)} className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50">
                                    <span className="font-medium text-slate-800">{g.name}</span>{' '}
                                    <span className="text-slate-400">
                                      {g.phone}
                                      {g.city ? ` · ${g.city}` : ''}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </Field>
                        <p className="mt-1.5 text-xs text-slate-400">
                          {searching ? 'Searching…' : 'Enter 10 digits; if a saved guest appears, select them to load details.'}
                        </p>
                      </div>

                      <div className="grid grid-cols-4 gap-3">
                        <Field label="Title">
                          <select className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)}>
                            {TITLES.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <div className="col-span-3">
                          <Field label={mode === 'existing' && selectedReservation?.bookedByName ? "This room's guest name" : 'Full name'}>
                            <input className={inputClass} value={guestName} onChange={(e) => setGuestName(e.target.value)} required autoFocus />
                          </Field>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-3">
                        <Field label="Email">
                          <input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                        </Field>
                        <Field label="Gender">
                          <select className={inputClass} value={gender} onChange={(e) => setGender(e.target.value as Gender)}>
                            <option value="">— select —</option>
                            <option value="male">Male</option>
                            <option value="female">Female</option>
                            <option value="other">Other</option>
                            <option value="prefer_not_to_say">Prefer not to say</option>
                          </select>
                        </Field>
                        <Field label="Date of birth">
                          <input className={inputClass} type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} />
                        </Field>
                      </div>
                      {dateOfBirth && !isAdult(dateOfBirth) && <p className="-mt-2 text-xs text-red-600">Must be at least 18 years old</p>}

                      <Field label="Guest address">
                        <textarea className={`${inputClass} min-h-16`} value={address} onChange={(e) => setAddress(e.target.value)} />
                      </Field>

                      <div className="grid grid-cols-4 gap-3">
                        <Field label="Country">
                          <input className={inputClass} value={country} onChange={(e) => setCountry(e.target.value)} />
                        </Field>
                        <Field label="State">
                          <input className={inputClass} value={state} onChange={(e) => setState(e.target.value)} />
                        </Field>
                        <Field label="City">
                          <input className={inputClass} value={city} onChange={(e) => setCity(e.target.value)} />
                        </Field>
                        <Field label="Pincode">
                          <input className={inputClass} value={pincode} onChange={(e) => setPincode(e.target.value)} />
                        </Field>
                      </div>

                      {/* ID type itself is the pill row above (Guest Identification) — just the
                          number stays here, editable after OCR fills it (or typed manually). */}
                      <Field label="ID number">
                        <input className={inputClass} value={idNumber} onChange={(e) => setIdNumber(e.target.value)} required />
                      </Field>

                      <Field label="Purpose of stay *">
                        <select className={inputClass} value={purposeOfStay} onChange={(e) => setPurposeOfStay(e.target.value)} required>
                          <option value="">— select —</option>
                          {PURPOSES.map((p) => (
                            <option key={p} value={p}>
                              {p}
                            </option>
                          ))}
                        </select>
                      </Field>

                      {/* Individual/Company itself is toggled from the section header above —
                          this just reveals the company-billing fields once Company is picked. */}
                      {isCorporate && (
                        <div className="space-y-3 rounded-lg bg-slate-50 p-3">
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                              <input
                                className={inputClass}
                                value={companyPhone}
                                onChange={(e) => setCompanyPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                                placeholder="10-digit mobile"
                              />
                            </Field>
                          </div>
                          <Field label="Company Email">
                            <input className={inputClass} type="email" value={companyEmail} onChange={(e) => setCompanyEmail(e.target.value)} />
                          </Field>
                          <Field label="Address">
                            <textarea className={`${inputClass} min-h-14`} value={companyAddress} onChange={(e) => setCompanyAddress(e.target.value)} />
                          </Field>
                          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
                  </Card>
                </>
              )}

              {error && <p className="text-sm text-red-600">{error}</p>}

              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="secondary" onClick={handleClose}>
                  Cancel
                </Button>
                <Button type="submit" variant="royal">Next · Payment</Button>
              </div>
            </form>
          </>
        )}

        {/* §bugfix — same nested-scroll issue as step 1's form: this box's own max-h/overflow
            used to compete with the panel Card's, cutting off InvoiceStep's own Back/Cancel/
            Complete row. The Card's single scroll region is enough. */}
        {step === 2 && (
          <div>
            <InvoiceStep
              guestName={guestName}
              guestPhone={guestPhone || undefined}
              totalAmount={totalAmount}
              alreadyPaid={mode === 'existing' ? Number(selectedReservation?.paidAmount ?? 0) : 0}
              onBack={() => setStep(1)}
              onClose={handleClose}
              onComplete={completeCheckIn}
              busy={busy}
            />
          </div>
        )}

        {step === 3 && successInfo && (
          <div className="flex flex-col items-center px-2 py-6 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-8 w-8">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </div>
            <h4 className="mt-4 text-lg font-bold text-slate-900">Checked in successfully</h4>
            <p className="mt-1 text-sm text-slate-500">Your guest is all set for a comfortable stay.</p>

            <div className="mt-5 w-full divide-y divide-slate-100 rounded-xl border border-slate-200 text-sm">
              <div className="flex items-center justify-between px-4 py-2.5">
                <span className="text-slate-500">Room</span>
                <span className="font-semibold text-royal-600">{successInfo.roomNumber}</span>
              </div>
              <div className="flex items-center justify-between px-4 py-2.5">
                <span className="text-slate-500">Checked in</span>
                <span className="font-medium text-slate-900">{formatDateTimeShort(successInfo.checkedInAt.toISOString())}</span>
              </div>
            </div>

            <Button type="button" variant="royal" className="mt-5 w-full justify-center" onClick={finish}>
              Done {successCountdown > 0 ? `· ${successCountdown}s` : ''}
            </Button>
          </div>
        )}
      </Card>

      {cameraFor && (
        <CameraCapture
          onCapture={(file) => {
            handleAiCheckIn(cameraFor, file);
            setCameraFor(null);
          }}
          onClose={() => setCameraFor(null)}
        />
      )}
    </div>
  );
}

function SectionHeader({ icon, title, action }: { icon: string; title: string; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2.5">
      <div className="flex items-center gap-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-royal-50 text-sm">{icon}</span>
        <h5 className="text-xs font-bold uppercase tracking-wide text-slate-500">{title}</h5>
      </div>
      {action}
    </div>
  );
}

// §user request — "upload hone ke baad picture bani aani chahiye" (thumbnail once picked/
// captured) + "upload bhi ho sake aur real-time image bhi click kar sake" (an Upload button next
// to a Camera one, not just one or the other).
function IdPhotoSlot({
  label,
  hint,
  previewUrl,
  scanning,
  onUpload,
  onCamera,
  onRemove,
}: {
  label: string;
  hint: string;
  previewUrl: string | null;
  scanning: boolean;
  onUpload: () => void;
  onCamera: () => void;
  onRemove: () => void;
}) {
  if (previewUrl) {
    return (
      <div className="relative overflow-hidden rounded-lg border border-slate-300">
        <img src={previewUrl} alt={label} className="h-32 w-full object-cover" />
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/60 px-2 py-1.5">
          <span className="text-xs font-semibold text-white">{label} ✓</span>
          <button type="button" onClick={onRemove} className="text-xs font-semibold text-white underline">
            Replace
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white p-4 text-center">
      <span className="text-sm font-semibold text-slate-700">{label}</span>
      <span className="text-xs text-slate-400">{hint}</span>
      <div className="mt-1 flex w-full gap-2">
        <button
          type="button"
          onClick={onUpload}
          disabled={scanning}
          className="flex-1 rounded-lg border border-slate-300 py-1.5 text-xs font-semibold text-slate-600 hover:border-royal-400 disabled:opacity-60"
        >
          📁 Upload
        </button>
        <button
          type="button"
          onClick={onCamera}
          disabled={scanning}
          className="flex-1 rounded-lg border border-slate-300 py-1.5 text-xs font-semibold text-slate-600 hover:border-royal-400 disabled:opacity-60"
        >
          📷 Camera
        </button>
      </div>
    </div>
  );
}
