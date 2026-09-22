import { useEffect, useState } from 'react';
import { mutate, query, ApiError } from '../api';
import { useAuth } from '../AuthContext';
import type { Hotel, Room, RoomCategory } from '../types';

export function Onboarding({ hotel, onHotelCreated }: { hotel: Hotel | null; onHotelCreated: (h: Hotel) => void }) {
  const { token } = useAuth();
  const [error, setError] = useState<string | null>(null);

  // create hotel
  const [name, setName] = useState('Hotel Sunrise');
  const [city, setCity] = useState('Jaipur');
  const [roomCount, setRoomCount] = useState(6);
  const [staffCount, setStaffCount] = useState(2);
  const [busy, setBusy] = useState(false);

  async function createHotel(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const h = await mutate<Hotel>('hotels.create', {
        name,
        city,
        expectedRoomCount: roomCount,
        expectedStaffCount: staffCount,
        dpdpConsent: true,
      });
      onHotelCreated(h);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create hotel');
    } finally {
      setBusy(false);
    }
  }

  if (!hotel) {
    return (
      <div className="card">
        <h3>Step 1 — Create your hotel</h3>
        <p className="hint">Mints the Hotel ID (short code) staff will use to log in with a PIN.</p>
        <form onSubmit={createHotel}>
          <label>
            Hotel name
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            City
            <input value={city} onChange={(e) => setCity(e.target.value)} />
          </label>
          <label>
            Expected room count
            <input type="number" value={roomCount} onChange={(e) => setRoomCount(Number(e.target.value))} min={1} />
          </label>
          <label>
            Expected staff count
            <input type="number" value={staffCount} onChange={(e) => setStaffCount(Number(e.target.value))} min={1} />
          </label>
          {error && <p className="error">{error}</p>}
          <button type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create hotel'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div>
      <div className="card">
        <h3>{hotel.name}</h3>
        <p>
          Hotel ID (share with staff): <strong className="shortcode">{hotel.shortCode}</strong>
        </p>
      </div>
      <RoomCategoriesSection hotelId={hotel.id} token={token} />
      <RoomsSection hotelId={hotel.id} token={token} />
      <StaffSection hotelId={hotel.id} token={token} />
    </div>
  );
}

function RoomCategoriesSection({ hotelId, token }: { hotelId: string; token: string | null }) {
  const [categories, setCategories] = useState<RoomCategory[]>([]);
  const [categoryName, setCategoryName] = useState('Deluxe Double');
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setCategories(await query<RoomCategory[]>('hotels.listRoomCategories', { hotelId }, token ?? undefined));
  }
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId]);

  async function addCategory(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await mutate('hotels.createRoomCategory', { hotelId, name: categoryName }, token ?? undefined);
      setCategoryName('');
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed');
    }
  }

  return (
    <div className="card">
      <h3>Step 2 — Room categories</h3>
      <ul>
        {categories.map((c) => (
          <li key={c.id}>{c.name}</li>
        ))}
      </ul>
      <form onSubmit={addCategory} className="inline-form">
        <input value={categoryName} onChange={(e) => setCategoryName(e.target.value)} placeholder="e.g. Deluxe Double" />
        <button type="submit">Add category</button>
      </form>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function RoomsSection({ hotelId, token }: { hotelId: string; token: string | null }) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [categories, setCategories] = useState<RoomCategory[]>([]);
  const [count, setCount] = useState(6);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const [r, c] = await Promise.all([
      query<Room[]>('hotels.listRooms', { hotelId }, token ?? undefined),
      query<RoomCategory[]>('hotels.listRoomCategories', { hotelId }, token ?? undefined),
    ]);
    setRooms(r);
    setCategories(c);
  }
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId]);

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await mutate('hotels.generatePlaceholderRooms', { hotelId, count }, token ?? undefined);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed');
    }
  }

  async function assign(roomId: string, roomCategoryId: string) {
    await mutate('hotels.assignRoomCategory', { roomId, roomCategoryId: roomCategoryId || null }, token ?? undefined);
    await refresh();
  }

  return (
    <div className="card">
      <h3>Step 3 — Rooms</h3>
      <form onSubmit={generate} className="inline-form">
        <input type="number" value={count} onChange={(e) => setCount(Number(e.target.value))} min={1} />
        <button type="submit">Generate placeholder rooms</button>
      </form>
      {error && <p className="error">{error}</p>}
      <table>
        <thead>
          <tr>
            <th>Room</th>
            <th>Category</th>
          </tr>
        </thead>
        <tbody>
          {rooms.map((r) => (
            <tr key={r.id}>
              <td>{r.roomNumber}</td>
              <td>
                <select value={r.roomCategoryId ?? ''} onChange={(e) => assign(r.id, e.target.value)}>
                  <option value="">— uncategorized —</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StaffSection({ hotelId, token }: { hotelId: string; token: string | null }) {
  const [staffName, setStaffName] = useState('');
  const [role, setRole] = useState<'front_desk' | 'housekeeping'>('front_desk');
  const [pin, setPin] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function addStaff(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    try {
      await mutate('auth.createStaffPin', { hotelId, name: staffName, role, pin }, token ?? undefined);
      setMessage(`Created ${staffName} (${role}) with PIN ${pin}`);
      setStaffName('');
      setPin('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed');
    }
  }

  return (
    <div className="card">
      <h3>Step 4 — Staff PINs</h3>
      <form onSubmit={addStaff}>
        <label>
          Name
          <input value={staffName} onChange={(e) => setStaffName(e.target.value)} required />
        </label>
        <label>
          Role
          <select value={role} onChange={(e) => setRole(e.target.value as 'front_desk' | 'housekeeping')}>
            <option value="front_desk">Front Desk</option>
            <option value="housekeeping">Housekeeping</option>
          </select>
        </label>
        <label>
          PIN (4-6 digits)
          <input value={pin} onChange={(e) => setPin(e.target.value)} required minLength={4} maxLength={6} />
        </label>
        {error && <p className="error">{error}</p>}
        {message && <p className="hint">{message}</p>}
        <button type="submit">Add staff member</button>
      </form>
    </div>
  );
}
