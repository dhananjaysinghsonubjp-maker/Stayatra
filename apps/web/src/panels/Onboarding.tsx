import { useEffect, useState } from 'react';
import { mutate, query, ApiError } from '../api';
import { useAuth } from '../AuthContext';
import { Button, Card, CardBody, CardHeader, Field, PageHeader, inputClass } from '../components/ui';
import type { Hotel, Room, RoomCategory, StaffMember } from '../types';

export function Onboarding({
  hotel,
  onHotelCreated,
  hasPms = true,
}: {
  hotel: Hotel | null;
  onHotelCreated: (h: Hotel) => void;
  /** Whether this org's plan includes PMS — gates the physical-room/staff-PIN setup steps below, which a Channel-Manager-only org has no use for. */
  hasPms?: boolean;
}) {
  const { token } = useAuth();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('Hotel Sunrise');
  const [city, setCity] = useState('Jaipur');
  const [roomCount, setRoomCount] = useState(6);
  const [staffCount, setStaffCount] = useState(2);
  const [dpdpConsent, setDpdpConsent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function createHotel(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const h = await mutate<Hotel>(
        'hotels.create',
        { name, city, expectedRoomCount: roomCount, expectedStaffCount: staffCount, dpdpConsent },
        token ?? undefined,
      );
      onHotelCreated(h);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create hotel');
    } finally {
      setBusy(false);
    }
  }

  if (!hotel) {
    return (
      <Card>
        <CardHeader title="Create your hotel" subtitle="Mints the Hotel ID staff will use to log in with a PIN." />
        <CardBody>
          <form onSubmit={createHotel} className="space-y-4">
            <Field label="Hotel name">
              <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
            <Field label="City">
              <input className={inputClass} value={city} onChange={(e) => setCity(e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Expected room count">
                <input className={inputClass} type="number" value={roomCount} onChange={(e) => setRoomCount(Number(e.target.value))} min={1} />
              </Field>
              <Field label="Expected staff count">
                <input className={inputClass} type="number" value={staffCount} onChange={(e) => setStaffCount(Number(e.target.value))} min={1} />
              </Field>
            </div>
            <label className="flex items-start gap-2.5 text-sm text-slate-600">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                checked={dpdpConsent}
                onChange={(e) => setDpdpConsent(e.target.checked)}
              />
              <span>
                I consent to this platform processing this hotel's guest and business data under the Digital Personal Data Protection
                (DPDP) Act, 2023, as a Data Fiduciary on our behalf.
              </span>
            </label>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" disabled={busy || !dpdpConsent}>
              {busy ? 'Creating…' : 'Create hotel'}
            </Button>
          </form>
        </CardBody>
      </Card>
    );
  }

  return (
    <div>
      <PageHeader title="Staff & Setup" subtitle={hotel.name} />
      <Card className="mb-6">
        <CardBody className="flex items-center justify-between">
          <span className="text-sm text-slate-600">Hotel ID (share with staff for PIN login)</span>
          <span className="rounded-md bg-amber-50 px-3 py-1 font-mono text-base font-semibold text-amber-700">{hotel.shortCode}</span>
        </CardBody>
      </Card>
      <div className="space-y-6">
        <RoomCategoriesSection hotelId={hotel.id} token={token} />
        {hasPms && <RoomsSection hotelId={hotel.id} token={token} />}
        {hasPms && <StaffSection hotelId={hotel.id} token={token} />}
      </div>
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
    <Card>
      <CardHeader title="Room categories" />
      <CardBody>
        {categories.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {categories.map((c) => (
              <span key={c.id} className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                {c.name}
              </span>
            ))}
          </div>
        )}
        <form onSubmit={addCategory} className="flex gap-2">
          <input className={`${inputClass} flex-1`} value={categoryName} onChange={(e) => setCategoryName(e.target.value)} placeholder="e.g. Deluxe Double" />
          <Button type="submit" variant="secondary">
            Add
          </Button>
        </form>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </CardBody>
    </Card>
  );
}

function RoomsSection({ hotelId, token }: { hotelId: string; token: string | null }) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [categories, setCategories] = useState<RoomCategory[]>([]);
  const [count, setCount] = useState(6);
  const [newRoomNumber, setNewRoomNumber] = useState('');
  const [newRoomCategoryId, setNewRoomCategoryId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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

  async function addSingleRoom(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await mutate('hotels.addRoom', { hotelId, roomNumber: newRoomNumber, roomCategoryId: newRoomCategoryId || null }, token ?? undefined);
      setNewRoomNumber('');
      setNewRoomCategoryId('');
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add room');
    }
  }

  async function assign(roomId: string, roomCategoryId: string) {
    await mutate('hotels.assignRoomCategory', { roomId, roomCategoryId: roomCategoryId || null }, token ?? undefined);
    await refresh();
  }

  async function rename(roomId: string, roomNumber: string, previous: string) {
    if (!roomNumber.trim() || roomNumber === previous) return;
    setRowError(null);
    try {
      await mutate('hotels.renameRoom', { roomId, roomNumber: roomNumber.trim() }, token ?? undefined);
      await refresh();
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : 'Failed to rename room');
      await refresh(); // revert the input to the persisted value
    }
  }

  async function remove(roomId: string, roomNumber: string) {
    if (!confirm(`Remove ${roomNumber}? This can't be undone if it has never been used.`)) return;
    setRowError(null);
    setDeletingId(roomId);
    try {
      await mutate('hotels.deleteRoom', { roomId }, token ?? undefined);
      await refresh();
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : 'Failed to remove room');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <Card>
      <CardHeader title="Rooms" subtitle="Generate placeholder rooms, then sort them into categories — or add/remove/rename rooms individually." />
      <CardBody>
        <form onSubmit={generate} className="mb-3 flex gap-2">
          <input className={`${inputClass} w-28`} type="number" value={count} onChange={(e) => setCount(Number(e.target.value))} min={1} />
          <Button type="submit" variant="secondary">
            Generate placeholder rooms
          </Button>
        </form>
        <form onSubmit={addSingleRoom} className="mb-4 flex gap-2">
          <input
            className={`${inputClass} w-40`}
            placeholder="Room number/name"
            value={newRoomNumber}
            onChange={(e) => setNewRoomNumber(e.target.value)}
            required
          />
          <select className={`${inputClass} w-48`} value={newRoomCategoryId} onChange={(e) => setNewRoomCategoryId(e.target.value)}>
            <option value="">— uncategorized —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <Button type="submit" variant="secondary">
            + Add room
          </Button>
        </form>
        {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
        {rowError && <p className="mb-2 text-sm text-red-600">{rowError}</p>}
        {rooms.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-medium text-slate-500">
                  <th className="py-2 pr-4">Room</th>
                  <th className="py-2 pr-4">Category</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rooms.map((r) => (
                  <RoomRow key={r.id} room={r} categories={categories} onAssign={assign} onRename={rename} onRemove={remove} removing={deletingId === r.id} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function RoomRow({
  room,
  categories,
  onAssign,
  onRename,
  onRemove,
  removing,
}: {
  room: Room;
  categories: RoomCategory[];
  onAssign: (roomId: string, roomCategoryId: string) => void;
  onRename: (roomId: string, roomNumber: string, previous: string) => void;
  onRemove: (roomId: string, roomNumber: string) => void;
  removing: boolean;
}) {
  const [roomNumber, setRoomNumber] = useState(room.roomNumber);
  useEffect(() => setRoomNumber(room.roomNumber), [room.roomNumber]);
  const canRemove = room.status === 'available';

  return (
    <tr>
      <td className="py-2 pr-4">
        <input
          className={`${inputClass} w-44 py-1.5 font-medium text-slate-900`}
          value={roomNumber}
          onChange={(e) => setRoomNumber(e.target.value)}
          onBlur={() => onRename(room.id, roomNumber, room.roomNumber)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
      </td>
      <td className="py-2 pr-4">
        <select className={`${inputClass} py-1.5`} value={room.roomCategoryId ?? ''} onChange={(e) => onAssign(room.id, e.target.value)}>
          <option value="">— uncategorized —</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </td>
      <td className="py-2 pr-4 text-xs capitalize text-slate-500">{room.status}</td>
      <td className="py-2 text-right">
        <button
          type="button"
          onClick={() => onRemove(room.id, room.roomNumber)}
          disabled={!canRemove || removing}
          title={canRemove ? 'Remove this room' : 'Cannot remove an occupied/housekeeping room'}
          className="text-xs font-medium text-red-500 hover:underline disabled:cursor-not-allowed disabled:text-slate-300 disabled:no-underline"
        >
          {removing ? 'Removing…' : 'Remove'}
        </button>
      </td>
    </tr>
  );
}

function StaffSection({ hotelId, token }: { hotelId: string; token: string | null }) {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [staffName, setStaffName] = useState('');
  const [role, setRole] = useState<'front_desk' | 'housekeeping'>('front_desk');
  const [pin, setPin] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setStaff(await query<StaffMember[]>('hotels.listStaff', { hotelId }, token ?? undefined));
  }
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId]);

  async function addStaff(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    try {
      await mutate('auth.createStaffPin', { hotelId, name: staffName, role, pin }, token ?? undefined);
      setMessage(`Created ${staffName} (${role}) with PIN ${pin}`);
      setStaffName('');
      setPin('');
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed');
    }
  }

  return (
    <Card>
      <CardHeader title="Staff PINs" subtitle="Owner creates every staff account — no self-registration (§8.2)." />
      <CardBody>
        {staff.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-2">
            {staff.map((s) => (
              <span key={s.id} className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                {s.name} · {s.role?.replace('_', ' ')}
              </span>
            ))}
          </div>
        )}
        <form onSubmit={addStaff} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Name">
            <input className={inputClass} value={staffName} onChange={(e) => setStaffName(e.target.value)} required />
          </Field>
          <Field label="Role">
            <select className={inputClass} value={role} onChange={(e) => setRole(e.target.value as 'front_desk' | 'housekeeping')}>
              <option value="front_desk">Front Desk</option>
              <option value="housekeeping">Housekeeping</option>
            </select>
          </Field>
          <Field label="PIN (4-6 digits)">
            <input className={inputClass} value={pin} onChange={(e) => setPin(e.target.value)} required minLength={4} maxLength={6} />
          </Field>
          <div className="sm:col-span-3">
            {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
            {message && <p className="mb-2 text-sm text-emerald-600">{message}</p>}
            <Button type="submit">Add staff member</Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
