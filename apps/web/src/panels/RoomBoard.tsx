import { useEffect, useState } from 'react';
import { mutate, query, ApiError } from '../api';
import { useAuth } from '../AuthContext';
import type { Room } from '../types';

export function RoomBoard({ hotelId }: { hotelId: string }) {
  const { token, role } = useAuth();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [checkInRoom, setCheckInRoom] = useState<Room | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canCheckIn = ['owner', 'manager', 'front_desk'].includes(role('pms') ?? '');

  async function refresh() {
    try {
      setRooms(await query<Room[]>('bookings.getRoomBoard', { hotelId }, token ?? undefined));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load room board');
    }
  }
  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId]);

  return (
    <div className="card">
      <h3>Room Board</h3>
      {error && <p className="error">{error}</p>}
      <div className="room-grid">
        {rooms.map((r) => (
          <div key={r.id} className={`room-tile status-${r.status}`}>
            <strong>{r.roomNumber}</strong>
            <span>{r.roomCategory?.name ?? 'uncategorized'}</span>
            <span className="badge">{r.status}</span>
            {r.currentStay && <span>{r.currentStay.guestName}</span>}
            {r.status === 'available' && canCheckIn && (
              <button onClick={() => setCheckInRoom(r)}>Check in</button>
            )}
          </div>
        ))}
      </div>
      {checkInRoom && (
        <CheckInModal room={checkInRoom} hotelId={hotelId} onClose={() => setCheckInRoom(null)} onDone={refresh} />
      )}
    </div>
  );
}

function CheckInModal({
  room,
  hotelId,
  onClose,
  onDone,
}: {
  room: Room;
  hotelId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { token } = useAuth();
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [nights, setNights] = useState(1);
  const [totalAmount, setTotalAmount] = useState(2000);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const checkIn = new Date();
      const checkOut = new Date(Date.now() + nights * 86400000);
      await mutate(
        'bookings.checkInWalkIn',
        {
          hotelId,
          roomId: room.id,
          guestName,
          guestPhone: guestPhone || undefined,
          checkIn: checkIn.toISOString(),
          checkOut: checkOut.toISOString(),
          nights,
          totalAmount,
        },
        token ?? undefined,
      );
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Check-in failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h4>Check in — {room.roomNumber}</h4>
        <form onSubmit={submit}>
          <label>
            Guest name
            <input value={guestName} onChange={(e) => setGuestName(e.target.value)} required />
          </label>
          <label>
            Phone (10 digits, optional)
            <input value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} pattern="\d{10}" />
          </label>
          <label>
            Nights
            <input type="number" value={nights} onChange={(e) => setNights(Number(e.target.value))} min={1} />
          </label>
          <label>
            Total amount (₹)
            <input type="number" value={totalAmount} onChange={(e) => setTotalAmount(Number(e.target.value))} min={0} />
          </label>
          {error && <p className="error">{error}</p>}
          <div className="modal-actions">
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" disabled={busy}>
              {busy ? 'Checking in…' : 'Check in'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
