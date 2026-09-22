import { useEffect, useState } from 'react';
import { mutate, query, ApiError } from '../api';
import { useAuth } from '../AuthContext';
import type { Booking, RoomCategory } from '../types';

function todayPlus(days: number) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

export function Bookings({ hotelId }: { hotelId: string }) {
  const { token } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [categories, setCategories] = useState<RoomCategory[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [payingBooking, setPayingBooking] = useState<Booking | null>(null);

  async function refresh() {
    try {
      const [b, c] = await Promise.all([
        query<Booking[]>('bookings.listReservations', { hotelId }, token ?? undefined),
        query<RoomCategory[]>('hotels.listRoomCategories', { hotelId }, token ?? undefined),
      ]);
      setBookings(b);
      setCategories(c);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load reservations');
    }
  }
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId]);

  return (
    <div className="card">
      <h3>Reservations</h3>
      <ManualBookingForm hotelId={hotelId} categories={categories} onDone={refresh} />
      {error && <p className="error">{error}</p>}
      <table>
        <thead>
          <tr>
            <th>Guest</th>
            <th>Dates</th>
            <th>Status</th>
            <th>Source</th>
            <th>Paid / Total</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {bookings.map((b) => {
            const outstanding = Number(b.totalAmount) - Number(b.paidAmount ?? 0);
            return (
              <tr key={b.id}>
                <td>{b.guestName}</td>
                <td>
                  {b.checkIn.slice(0, 10)} → {b.checkOut.slice(0, 10)}
                </td>
                <td>
                  <span className={`tag tag-${b.status}`}>{b.status}</span>
                </td>
                <td>{b.source}</td>
                <td>
                  ₹{b.paidAmount ?? 0} / ₹{b.totalAmount} {outstanding > 0 ? `(₹${outstanding} due)` : '(Paid in full)'}
                </td>
                <td>
                  {outstanding > 0 && <button onClick={() => setPayingBooking(b)}>Add payment</button>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {payingBooking && (
        <AddPaymentModal booking={payingBooking} onClose={() => setPayingBooking(null)} onDone={refresh} />
      )}
    </div>
  );
}

function ManualBookingForm({
  hotelId,
  categories,
  onDone,
}: {
  hotelId: string;
  categories: RoomCategory[];
  onDone: () => void;
}) {
  const { token } = useAuth();
  const [guestName, setGuestName] = useState('');
  const [roomCategoryId, setRoomCategoryId] = useState('');
  const [checkIn, setCheckIn] = useState(todayPlus(3));
  const [checkOut, setCheckOut] = useState(todayPlus(5));
  const [nights, setNights] = useState(2);
  const [totalAmount, setTotalAmount] = useState(4000);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await mutate(
        'bookings.createManualBooking',
        { hotelId, guestName, roomCategoryId, checkIn, checkOut, nights, totalAmount },
        token ?? undefined,
      );
      setGuestName('');
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create booking');
    }
  }

  return (
    <form onSubmit={submit} className="card nested">
      <h4>Manual booking (future-dated, §8.4)</h4>
      <div className="grid-controls">
        <label>
          Guest name
          <input value={guestName} onChange={(e) => setGuestName(e.target.value)} required />
        </label>
        <label>
          Room category
          <select value={roomCategoryId} onChange={(e) => setRoomCategoryId(e.target.value)} required>
            <option value="">— select —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Check-in
          <input type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
        </label>
        <label>
          Check-out
          <input type="date" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
        </label>
        <label>
          Nights
          <input type="number" value={nights} onChange={(e) => setNights(Number(e.target.value))} min={1} />
        </label>
        <label>
          Total amount (₹)
          <input type="number" value={totalAmount} onChange={(e) => setTotalAmount(Number(e.target.value))} min={0} />
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      <button type="submit">Create reservation</button>
    </form>
  );
}

function AddPaymentModal({ booking, onClose, onDone }: { booking: Booking; onClose: () => void; onDone: () => void }) {
  const { token } = useAuth();
  const outstanding = Number(booking.totalAmount) - Number(booking.paidAmount ?? 0);
  const [amount, setAmount] = useState(outstanding);
  const [method, setMethod] = useState<'cash' | 'online' | 'card'>('cash');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await mutate('bookings.addPayment', { bookingId: booking.id, amount, method }, token ?? undefined);
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Payment failed');
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h4>Add payment — {booking.guestName}</h4>
        <p className="hint">Outstanding: ₹{outstanding}</p>
        <form onSubmit={submit}>
          <label>
            Amount (₹)
            <input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} min={1} />
          </label>
          <label>
            Method
            <select value={method} onChange={(e) => setMethod(e.target.value as 'cash' | 'online' | 'card')}>
              <option value="cash">Cash</option>
              <option value="online">Online</option>
              <option value="card">Card</option>
            </select>
          </label>
          {error && <p className="error">{error}</p>}
          <div className="modal-actions">
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit">Record payment</button>
          </div>
        </form>
      </div>
    </div>
  );
}
