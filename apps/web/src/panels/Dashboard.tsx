import { useEffect, useState } from 'react';
import { query } from '../api';
import { useAuth } from '../AuthContext';
import { Badge, Card, CardBody, CardHeader, EmptyState, PageHeader, StatCard } from '../components/ui';
import { ChannelManagerDashboard } from './channel-manager/ChannelManagerDashboard';
import type { Booking, CleaningRecord, Room } from '../types';
import type { Tab } from '../layout/Sidebar';

function isToday(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  return d.toDateString() === now.toDateString();
}

export function Dashboard({
  hotelId,
  onNavigate,
  hasPms = true,
  hasChannelManager = false,
}: {
  hotelId: string;
  onNavigate: (tab: Tab) => void;
  /** This whole dashboard (occupancy/arrivals/departures/collected) is PMS-shaped content — a Channel-Manager-only org has nothing here to show. */
  hasPms?: boolean;
  hasChannelManager?: boolean;
}) {
  const { token } = useAuth();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [cleanings, setCleanings] = useState<CleaningRecord[]>([]);

  useEffect(() => {
    if (!hasPms) return;
    async function load() {
      const [r, b, c] = await Promise.all([
        query<Room[]>('bookings.getRoomBoard', { hotelId }, token ?? undefined),
        query<Booking[]>('bookings.listReservations', { hotelId }, token ?? undefined),
        query<CleaningRecord[]>('cleaning.list', { hotelId, flaggedOnly: true }, token ?? undefined),
      ]);
      setRooms(r);
      setBookings(b);
      setCleanings(c);
    }
    void load();
    const id = setInterval(load, 8000);
    return () => clearInterval(id);
  }, [hotelId, token, hasPms]);

  if (!hasPms) {
    return (
      <div>
        <PageHeader title="Dashboard" subtitle="Today at a glance" />
        {hasChannelManager ? (
          <ChannelManagerDashboard hotelId={hotelId} onNavigate={onNavigate} />
        ) : (
          <Card>
            <CardBody>
              <EmptyState title="Welcome" hint="Ask an owner to enable a module for this account." />
            </CardBody>
          </Card>
        )}
      </div>
    );
  }

  const occupied = rooms.filter((r) => r.status === 'occupied').length;
  const total = rooms.length;
  const arrivals = bookings.filter((b) => isToday(b.checkIn) && b.status !== 'cancelled');
  const departures = bookings.filter((b) => isToday(b.checkOut) && b.status === 'checked_in');
  const collectedToday = bookings
    .flatMap((b) => b.payments ?? [])
    .filter((p) => isToday(p.collectedAt))
    .reduce((sum, p) => sum + Number(p.amount), 0);
  const unflaggedCleanings = cleanings.filter((c) => !c.resolvedAt);

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Today at a glance" />

      {hasChannelManager && <ChannelManagerDashboard hotelId={hotelId} onNavigate={onNavigate} />}

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Occupancy" value={total ? `${occupied}/${total}` : '—'} hint={total ? `${Math.round((occupied / total) * 100)}% occupied` : 'No rooms yet'} tone="brand" />
        <StatCard label="Arrivals today" value={arrivals.length} hint="confirmed & walk-in" />
        <StatCard label="Departures today" value={departures.length} hint="awaiting checkout cleaning" />
        <StatCard label="Collected today" value={`₹${collectedToday.toLocaleString('en-IN')}`} tone="brand" />
      </div>

      {unflaggedCleanings.length > 0 && (
        <Card className="mb-6 border-red-200">
          <CardHeader title="Needs attention" subtitle="No-guest discrepancies awaiting resolution" />
          <CardBody>
            <ul className="space-y-2">
              {unflaggedCleanings.map((c) => (
                <li key={c.id} className="flex items-center justify-between text-sm">
                  <span className="text-slate-700">
                    Room {rooms.find((r) => r.id === c.roomId)?.roomNumber ?? c.roomId} — {c.kind} cleaning flagged
                  </span>
                  <Badge tone="flagged">unresolved</Badge>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Room status"
            action={
              <button onClick={() => onNavigate('rooms')} className="text-xs font-medium text-brand-600 hover:underline">
                View room board →
              </button>
            }
          />
          <CardBody>
            {rooms.length === 0 ? (
              <EmptyState title="No rooms yet" hint="Add rooms from Staff & Setup" />
            ) : (
              <div className="flex flex-wrap gap-2">
                {rooms.map((r) => (
                  <span
                    key={r.id}
                    title={`${r.roomNumber} — ${r.status}`}
                    className={`flex h-9 w-9 items-center justify-center rounded-md text-xs font-semibold ${
                      r.status === 'available'
                        ? 'bg-emerald-50 text-emerald-700'
                        : r.status === 'occupied'
                          ? 'bg-amber-50 text-amber-700'
                          : 'bg-blue-50 text-blue-700'
                    }`}
                  >
                    {r.roomNumber.replace(/\D/g, '') || r.roomNumber.slice(0, 2)}
                  </span>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Today's arrivals"
            action={
              <button onClick={() => onNavigate('rooms')} className="text-xs font-medium text-brand-600 hover:underline">
                Check in →
              </button>
            }
          />
          <CardBody>
            {arrivals.length === 0 ? (
              <EmptyState title="No arrivals today" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {arrivals.map((b) => (
                  <li key={b.id} className="flex items-center justify-between py-2 text-sm">
                    <span className="text-slate-700">{b.guestName}</span>
                    <Badge tone={b.status}>{b.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
