import { useEffect, useState } from 'react';
import { mutate, query, ApiError } from '../api';
import { useAuth } from '../AuthContext';
import { Badge, Button, Card, EmptyState, Field, PageHeader, inputClass } from '../components/ui';
import type { Room } from '../types';

const STATUS_STYLE: Record<Room['status'], string> = {
  available: 'border-emerald-200 bg-emerald-50',
  occupied: 'border-amber-200 bg-amber-50',
  housekeeping: 'border-blue-200 bg-blue-50',
};

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

  const counts = {
    available: rooms.filter((r) => r.status === 'available').length,
    occupied: rooms.filter((r) => r.status === 'occupied').length,
    housekeeping: rooms.filter((r) => r.status === 'housekeeping').length,
  };

  return (
    <div>
      <PageHeader
        title="Room Board"
        subtitle={`${counts.available} available · ${counts.occupied} occupied · ${counts.housekeeping} in housekeeping`}
      />
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {rooms.length === 0 ? (
        <EmptyState title="No rooms yet" hint="Add rooms from Staff & Setup" />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {rooms.map((r) => (
            <div key={r.id} className={`flex flex-col gap-2 rounded-xl border p-4 ${STATUS_STYLE[r.status]}`}>
              <div className="flex items-start justify-between">
                <span className="text-base font-semibold text-slate-900">{r.roomNumber}</span>
                <Badge tone={r.status}>{r.status}</Badge>
              </div>
              <span className="text-xs text-slate-500">{r.roomCategory?.name ?? 'uncategorized'}</span>
              {r.currentStay && <span className="truncate text-sm font-medium text-slate-700">{r.currentStay.guestName}</span>}
              {r.status === 'available' && canCheckIn && (
                <Button variant="secondary" className="mt-1 w-full text-xs" onClick={() => setCheckInRoom(r)}>
                  Check in
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

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
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-slate-900/40 px-4" onClick={onClose}>
      <Card className="w-full max-w-sm p-5" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
        <h4 className="mb-4 text-sm font-semibold text-slate-900">Check in — {room.roomNumber}</h4>
        <form onSubmit={submit} className="space-y-3.5">
          <Field label="Guest name">
            <input className={inputClass} value={guestName} onChange={(e) => setGuestName(e.target.value)} required autoFocus />
          </Field>
          <Field label="Phone (10 digits, optional)">
            <input className={inputClass} value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} pattern="\d{10}" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Nights">
              <input className={inputClass} type="number" value={nights} onChange={(e) => setNights(Number(e.target.value))} min={1} />
            </Field>
            <Field label="Total amount (₹)">
              <input className={inputClass} type="number" value={totalAmount} onChange={(e) => setTotalAmount(Number(e.target.value))} min={0} />
            </Field>
          </div>
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
