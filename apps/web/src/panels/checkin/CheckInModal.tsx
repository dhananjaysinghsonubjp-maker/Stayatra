import { useEffect, useRef, useState } from 'react';
import { mutate, query, uploadFile, ApiError } from '../../api';
import { useAuth } from '../../AuthContext';
import { Badge, Button, Card, Field, inputClass } from '../../components/ui';
import { computeGstSlab } from '../../gst';
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
  /** Opened from Reservations — reservation is fixed, a physical room still needs to be assigned. */
  reservation?: Booking;
  onClose: () => void;
  onDone: () => void;
}

export function CheckInModal({ hotelId, room, reservation, onClose, onDone }: Props) {
  const { token } = useAuth();
  const [step, setStep] = useState<1 | 2>(1);
  const [mode, setMode] = useState<'new' | 'existing'>(reservation ? 'existing' : 'new');

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
  const [idType, setIdType] = useState<IdType>('aadhaar');
  const [idNumber, setIdNumber] = useState('');
  const [idPhotoPath, setIdPhotoPath] = useState<string | undefined>(undefined);

  // guest search / autofill
  const [matches, setMatches] = useState<Guest[]>([]);
  const [searching, setSearching] = useState(false);

  // AI check-in
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = useState(false);
  const [scanNotice, setScanNotice] = useState<string | null>(null);

  // stay / rate
  const [ratePlans, setRatePlans] = useState<RatePlan[]>([]);
  const [ratePlanId, setRatePlanId] = useState('');
  const [amountPerNight, setAmountPerNight] = useState(2000);
  const [nights, setNights] = useState(1);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // existing-reservation mode
  const [upcoming, setUpcoming] = useState<Booking[]>([]);
  const [selectedReservationId, setSelectedReservationId] = useState(reservation?.id ?? '');
  const [availableRooms, setAvailableRooms] = useState<Room[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState(room?.id ?? '');

  const selectedReservation = reservation ?? upcoming.find((r) => r.id === selectedReservationId) ?? null;
  const roomCategoryId = room?.roomCategoryId ?? selectedReservation?.roomCategoryId;
  const totalAmount = mode === 'new' ? amountPerNight * nights : Number(selectedReservation?.totalAmount ?? 0);
  const gst = computeGstSlab(totalAmount);

  useEffect(() => {
    if (mode !== 'existing' || reservation) return;
    query<Booking[]>('bookings.listUpcomingReservations', { hotelId, roomCategoryId: room?.roomCategoryId }, token ?? undefined).then(setUpcoming);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, hotelId]);

  useEffect(() => {
    if (!reservation) return;
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

  async function handleAiCheckIn(file: File) {
    setScanning(true);
    setScanNotice(null);
    setError(null);
    try {
      const result = await uploadFile<{ filePath: string; extracted: Record<string, string> & { confidence: string } }>(
        'uploads/id-scan',
        file,
        token ?? undefined,
      );
      const { extracted, filePath } = result;
      setIdPhotoPath(filePath);
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

  /** Pure validation + advance — nothing is saved until completeCheckIn (step 2's "Complete Check-in"). */
  function goToStepTwo(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

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

    setStep(2);
  }

  /** The one point where anything actually commits — everything from both steps bundled into a single mutation. */
  async function completeCheckIn(draft: InvoiceDraft) {
    setError(null);
    setBusy(true);
    try {
      // 'existing' mode never shows the guest-detail fields (they belong to the
      // reservation already) — fall back to what's on the reservation itself,
      // otherwise this silently sent an empty guestName and failed validation.
      const guestDetails = {
        guestId,
        title,
        guestName: mode === 'new' ? guestName : (selectedReservation?.guestName ?? ''),
        guestPhone: (mode === 'new' ? guestPhone : (selectedReservation?.guestPhone ?? undefined)) || undefined,
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
        purposeOfStay: purposeOfStay || undefined,
      };
      const invoiceExtras = {
        lineItems: draft.lineItems.map((li) => ({ description: li.description, quantity: li.quantity, unitPrice: li.unitPrice })),
        discountAmount: draft.discountAmount ?? undefined,
        gstExempt: draft.gstExempt,
        payment: draft.payment,
      };

      if (mode === 'new') {
        if (!room) throw new Error('No room selected');
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
            totalAmount,
            ...invoiceExtras,
          },
          token ?? undefined,
        );
      } else {
        if (!selectedReservation) throw new Error('Select a reservation');
        const roomId = reservation ? selectedRoomId : (room?.id ?? '');
        if (!roomId) throw new Error('Select a room');
        await mutate('bookings.checkInReservation', { bookingId: selectedReservation.id, roomId, ...guestDetails, ...invoiceExtras }, token ?? undefined);
      }
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Check-in failed');
    } finally {
      setBusy(false);
    }
  }

  const title_ = room ? `Check in — ${room.roomNumber}` : selectedReservation ? `Check in — ${selectedReservation.guestName}` : 'Check in';

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center overflow-y-auto bg-slate-900/40 px-4 py-8" onClick={onClose}>
      <Card className="w-full max-w-2xl p-5" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h4 className="text-sm font-semibold text-slate-900">{title_}</h4>
          {room?.roomCategory && <Badge tone="slate">{room.roomCategory.name}</Badge>}
        </div>

        <div className="mb-5 flex items-center justify-center gap-3">
          <StepDot n={1} active={step === 1} done={step > 1} />
          <div className={`h-px w-10 ${step > 1 ? 'bg-brand-500' : 'bg-slate-200'}`} />
          <StepDot n={2} active={step === 2} done={false} />
        </div>

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

            <form onSubmit={goToStepTwo} className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
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

              {mode === 'existing' && reservation && (
                <Field label="Room">
                  <select className={inputClass} value={selectedRoomId} onChange={(e) => setSelectedRoomId(e.target.value)} required>
                    <option value="">— select —</option>
                    {availableRooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.roomNumber}
                      </option>
                    ))}
                  </select>
                  {availableRooms.length === 0 && <p className="mt-1 text-xs text-slate-400">No available rooms in this category right now.</p>}
                </Field>
              )}

              {mode === 'existing' && selectedReservation && (
                <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                  <p>
                    <span className="font-medium text-slate-800">{selectedReservation.guestName}</span> · {selectedReservation.checkIn.slice(0, 10)} →{' '}
                    {selectedReservation.checkOut.slice(0, 10)} · {selectedReservation.nights} night{selectedReservation.nights === 1 ? '' : 's'}
                  </p>
                  <p className="mt-1">
                    Total ₹{selectedReservation.totalAmount} · GST slab {gst.label}
                  </p>
                </div>
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
                  <p className="-mt-2 text-xs text-slate-400">GST slab: {gst.label}</p>

                  <div className="flex items-center gap-3 rounded-lg border border-dashed border-slate-300 p-3">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(e) => e.target.files?.[0] && handleAiCheckIn(e.target.files[0])}
                    />
                    <Button type="button" variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={scanning}>
                      {scanning ? 'Scanning…' : '✨ AI Check-in — scan ID'}
                    </Button>
                    {scanNotice && <p className="text-xs text-amber-600">{scanNotice}</p>}
                  </div>

                  <div className="relative">
                    <Field label="Mobile number">
                      <input
                        className={inputClass}
                        value={guestPhone}
                        onChange={(e) => {
                          setGuestPhone(e.target.value);
                          setGuestId(undefined);
                        }}
                        pattern="\d{10}"
                        placeholder="10-digit number"
                      />
                    </Field>
                    <p className="-mt-2 text-xs text-slate-400">
                      {searching ? 'Searching…' : 'Enter 10 digits; if a saved guest appears, select them to load details.'}
                    </p>
                    {matches.length > 0 && (
                      <div className="absolute z-10 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-md">
                        {matches.map((g) => (
                          <button
                            key={g.id}
                            type="button"
                            onClick={() => applyGuest(g)}
                            className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                          >
                            <span className="font-medium text-slate-800">{g.name}</span>{' '}
                            <span className="text-slate-400">{g.phone}{g.city ? ` · ${g.city}` : ''}</span>
                          </button>
                        ))}
                      </div>
                    )}
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
                      <Field label="Full name">
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
                </>
              )}

              <div className="grid grid-cols-2 gap-3">
                <Field label="ID type">
                  <select className={inputClass} value={idType} onChange={(e) => setIdType(e.target.value as IdType)}>
                    {ID_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="ID number">
                  <input className={inputClass} value={idNumber} onChange={(e) => setIdNumber(e.target.value)} required />
                </Field>
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="secondary" onClick={onClose}>
                  Cancel
                </Button>
                <Button type="submit">Next · Payment</Button>
              </div>
            </form>
          </>
        )}

        {step === 2 && (
          <div className="max-h-[70vh] overflow-y-auto pr-1">
            <InvoiceStep
              guestName={mode === 'new' ? guestName : (selectedReservation?.guestName ?? '')}
              guestPhone={mode === 'new' ? guestPhone || undefined : (selectedReservation?.guestPhone ?? undefined)}
              totalAmount={totalAmount}
              alreadyPaid={mode === 'existing' ? Number(selectedReservation?.paidAmount ?? 0) : 0}
              onBack={() => setStep(1)}
              onClose={onClose}
              onComplete={completeCheckIn}
              busy={busy}
            />
          </div>
        )}
      </Card>
    </div>
  );
}

function StepDot({ n, active, done }: { n: number; active: boolean; done: boolean }) {
  return (
    <div
      className={`flex h-8 w-8 items-center justify-center rounded-full border-2 text-sm font-semibold ${
        done ? 'border-brand-500 bg-brand-500 text-white' : active ? 'border-brand-500 text-brand-600' : 'border-slate-200 text-slate-400'
      }`}
    >
      {done ? '✓' : n}
    </div>
  );
}
