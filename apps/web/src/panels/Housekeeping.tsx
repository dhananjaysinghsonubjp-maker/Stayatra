import { useEffect, useState } from 'react';
import { mutate, query, ApiError } from '../api';
import { useAuth } from '../AuthContext';
import type { CleaningRecord, Room } from '../types';

export function Housekeeping({ hotelId }: { hotelId: string }) {
  const { token, user, role } = useAuth();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [records, setRecords] = useState<CleaningRecord[]>([]);
  const [roomId, setRoomId] = useState('');
  const [kind, setKind] = useState<'checkout' | 'guest_stay'>('checkout');
  const [photoCount, setPhotoCount] = useState(3);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const canResolve = ['owner', 'manager'].includes(role('pms') ?? '');

  async function refresh() {
    const [r, c] = await Promise.all([
      query<Room[]>('bookings.getRoomBoard', { hotelId }, token ?? undefined),
      query<CleaningRecord[]>('cleaning.list', { hotelId }, token ?? undefined),
    ]);
    setRooms(r);
    setRecords(c);
  }
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    try {
      const photos = Array.from({ length: photoCount }, (_, i) => `simulated-photo-${Date.now()}-${i}.jpg`);
      const record = await mutate<CleaningRecord>(
        'cleaning.submit',
        { hotelId, roomId, kind, primaryHousekeeperId: user?.userId, photos },
        token ?? undefined,
      );
      setResult(
        record.flagged
          ? 'Submitted — flagged as a no-guest discrepancy (room had no active stay).'
          : kind === 'checkout'
            ? 'Submitted — stay closed, room freed.'
            : 'Submitted.',
      );
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Submit failed');
    }
  }

  async function resolve(recordId: string) {
    const note = prompt('Resolution note?');
    if (!note) return;
    await mutate('cleaning.resolveDiscrepancy', { cleaningRecordId: recordId, note }, token ?? undefined);
    await refresh();
  }

  return (
    <div className="card">
      <h3>Housekeeping</h3>
      <p className="hint">
        Checkout Cleaning is the only way a stay gets closed and a room freed in this product — there is no separate
        front-desk checkout action, by design.
      </p>

      <form onSubmit={submit} className="card nested">
        <div className="grid-controls">
          <label>
            Room
            <select value={roomId} onChange={(e) => setRoomId(e.target.value)} required>
              <option value="">— select —</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.roomNumber} ({r.status}
                  {r.currentStay ? `, ${r.currentStay.guestName}` : ''})
                </option>
              ))}
            </select>
          </label>
          <label>
            Kind
            <select value={kind} onChange={(e) => setKind(e.target.value as 'checkout' | 'guest_stay')}>
              <option value="checkout">Checkout Cleaning</option>
              <option value="guest_stay">Guest Cleaning (mid-stay)</option>
            </select>
          </label>
          <label>
            Photos (simulated, min 3)
            <input type="number" value={photoCount} onChange={(e) => setPhotoCount(Number(e.target.value))} min={0} />
          </label>
        </div>
        {error && <p className="error">{error}</p>}
        {result && <p className="hint">{result}</p>}
        <button type="submit">Submit cleaning</button>
      </form>

      <table>
        <thead>
          <tr>
            <th>Room</th>
            <th>Kind</th>
            <th>Flagged</th>
            <th>Resolved</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <tr key={r.id} className={r.flagged && !r.resolvedAt ? 'flagged-row' : ''}>
              <td>{rooms.find((rm) => rm.id === r.roomId)?.roomNumber ?? r.roomId}</td>
              <td>{r.kind}</td>
              <td>{r.flagged ? 'Yes — no-guest discrepancy' : 'No'}</td>
              <td>{r.resolvedAt ? `Yes: ${r.resolvedNote ?? ''}` : '—'}</td>
              <td>{r.flagged && !r.resolvedAt && canResolve && <button onClick={() => resolve(r.id)}>Resolve</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
