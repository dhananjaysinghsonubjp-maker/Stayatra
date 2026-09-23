import { useEffect, useState } from 'react';
import { mutate, query, ApiError } from '../../api';
import { useAuth } from '../../AuthContext';
import { Button, Card, Field, inputClass } from '../../components/ui';
import { computeGstSlab } from '../../gst';
import type { Booking, IdType, Room } from '../../types';

const ID_TYPES: { value: IdType; label: string }[] = [
  { value: 'aadhaar', label: 'Aadhaar' },
  { value: 'passport', label: 'Passport' },
  { value: 'driving_license', label: 'Driving License' },
  { value: 'voter_id', label: 'Voter ID' },
  { value: 'other', label: 'Other' },
];

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
  const [mode, setMode] = useState<'new' | 'existing'>(reservation ? 'existing' : 'new');

  // shared
  const [idType, setIdType] = useState<IdType>('aadhaar');
  const [idNumber, setIdNumber] = useState('');
  const [collectPayment, setCollectPayment] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'online' | 'card'>('cash');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // new-guest mode
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [nights, setNights] = useState(1);
  const [totalAmount, setTotalAmount] = useState(2000);

  // existing-reservation mode
  const [upcoming, setUpcoming] = useState<Booking[]>([]);
  const [selectedReservationId, setSelectedReservationId] = useState(reservation?.id ?? '');
  const [availableRooms, setAvailableRooms] = useState<Room[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState(room?.id ?? '');

  const selectedReservation = reservation ?? upcoming.find((r) => r.id === selectedReservationId) ?? null;

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
    if (collectPayment && selectedReservation) {
      const due = Number(selectedReservation.totalAmount) - Number(selectedReservation.paidAmount ?? 0);
      setPaymentAmount(due);
    } else if (collectPayment && mode === 'new') {
      setPaymentAmount(totalAmount);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectPayment]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const payment = collectPayment && paymentAmount > 0 ? { amount: paymentAmount, method: paymentMethod } : undefined;

      if (mode === 'new') {
        if (!room) throw new Error('No room selected');
        if (!Number.isInteger(nights) || nights < 1 || nights > 365) throw new Error('Nights must be between 1 and 365');
        const checkIn = new Date();
        const checkOut = new Date(Date.now() + nights * 86400000);
        await mutate(
          'bookings.checkInWalkIn',
          {
            hotelId,
            roomId: room.id,
            guestName,
            guestPhone: guestPhone || undefined,
            idType,
            idNumber,
            checkIn: checkIn.toISOString(),
            checkOut: checkOut.toISOString(),
            nights,
            totalAmount,
            payment,
          },
          token ?? undefined,
        );
      } else {
        if (!selectedReservation) throw new Error('Select a reservation');
        const roomId = reservation ? selectedRoomId : (room?.id ?? '');
        if (!roomId) throw new Error('Select a room');
        await mutate(
          'bookings.checkInReservation',
          { bookingId: selectedReservation.id, roomId, idType, idNumber, payment },
          token ?? undefined,
        );
      }
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Check-in failed');
    } finally {
      setBusy(false);
    }
  }

  const gst = mode === 'new' ? computeGstSlab(totalAmount) : selectedReservation ? computeGstSlab(Number(selectedReservation.totalAmount)) : null;
  const title = room ? `Check in — ${room.roomNumber}` : selectedReservation ? `Check in — ${selectedReservation.guestName}` : 'Check in';

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center overflow-y-auto bg-slate-900/40 px-4 py-8" onClick={onClose}>
      <Card className="w-full max-w-lg p-5" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
        <h4 className="mb-4 text-sm font-semibold text-slate-900">{title}</h4>

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

        <form onSubmit={submit} className="space-y-3.5">
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
                Total ₹{selectedReservation.totalAmount} {gst && `· GST slab ${gst.label}`}
              </p>
            </div>
          )}

          {mode === 'new' && (
            <>
              <Field label="Guest name">
                <input className={inputClass} value={guestName} onChange={(e) => setGuestName(e.target.value)} required autoFocus />
              </Field>
              <Field label="Phone (10 digits, optional)">
                <input className={inputClass} value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} pattern="\d{10}" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Nights">
                  <input className={inputClass} type="number" value={nights} onChange={(e) => setNights(Number(e.target.value))} min={1} max={365} />
                </Field>
                <Field label="Total amount (₹)">
                  <input className={inputClass} type="number" value={totalAmount} onChange={(e) => setTotalAmount(Number(e.target.value))} min={0} />
                </Field>
              </div>
              {gst && <p className="-mt-2 text-xs text-slate-400">GST slab: {gst.label}</p>}
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

          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={collectPayment} onChange={(e) => setCollectPayment(e.target.checked)} className="rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
            Collect payment now
          </label>

          {collectPayment && (
            <div className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3">
              <Field label="Amount (₹)">
                <input className={inputClass} type="number" value={paymentAmount} onChange={(e) => setPaymentAmount(Number(e.target.value))} min={0} />
              </Field>
              <Field label="Method">
                <select className={inputClass} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as 'cash' | 'online' | 'card')}>
                  <option value="cash">Cash</option>
                  <option value="online">Online</option>
                  <option value="card">Card</option>
                </select>
              </Field>
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Checking in…' : 'Check in'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
