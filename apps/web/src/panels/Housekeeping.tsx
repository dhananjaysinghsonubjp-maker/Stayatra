import { useEffect, useState } from 'react';
import { mutate, query, ApiError } from '../api';
import { useAuth } from '../AuthContext';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, PageHeader, inputClass } from '../components/ui';
import type { CleaningRecord, HousekeeperStat, Room } from '../types';

export function Housekeeping({ hotelId }: { hotelId: string }) {
  const { token, user, role } = useAuth();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [records, setRecords] = useState<CleaningRecord[]>([]);
  const [stats, setStats] = useState<HousekeeperStat[]>([]);
  const [roomId, setRoomId] = useState('');
  const [kind, setKind] = useState<'checkout' | 'guest_stay'>('checkout');
  const [photoCount, setPhotoCount] = useState(3);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const canResolve = ['owner', 'manager'].includes(role('pms') ?? '');
  const canSeeTeamStatus = ['owner', 'manager', 'front_desk'].includes(role('pms') ?? '');

  async function refresh() {
    const [r, c] = await Promise.all([
      query<Room[]>('bookings.getRoomBoard', { hotelId }, token ?? undefined),
      query<CleaningRecord[]>('cleaning.list', { hotelId }, token ?? undefined),
    ]);
    setRooms(r);
    setRecords(c);
    if (canSeeTeamStatus) {
      setStats(await query<HousekeeperStat[]>('cleaning.housekeeperStats', { hotelId }, token ?? undefined));
    }
  }
  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, 15000);
    return () => clearInterval(id);
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
    <div>
      <PageHeader title="Housekeeping" subtitle="Checkout Cleaning closes the stay and frees the room — there's no separate front-desk checkout, by design." />

      <Card className="mb-6">
        <CardHeader title="Submit a cleaning" />
        <CardBody>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Room">
                <select className={inputClass} value={roomId} onChange={(e) => setRoomId(e.target.value)} required>
                  <option value="">— select —</option>
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.roomNumber} ({r.status}
                      {r.currentStay ? `, ${r.currentStay.guestName}` : ''})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Kind">
                <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value as 'checkout' | 'guest_stay')}>
                  <option value="checkout">Checkout Cleaning</option>
                  <option value="guest_stay">Guest Cleaning (mid-stay)</option>
                </select>
              </Field>
              <Field label="Photos (simulated, min 3)">
                <input className={inputClass} type="number" value={photoCount} onChange={(e) => setPhotoCount(Number(e.target.value))} min={0} />
              </Field>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            {result && <p className="text-sm text-emerald-600">{result}</p>}
            <Button type="submit">Submit cleaning</Button>
          </form>
        </CardBody>
      </Card>

      {canSeeTeamStatus && (
        <Card className="mb-6">
          <CardHeader title="Housekeeping team" subtitle="Who's cleaning, and how much they've done today." />
          {stats.length === 0 ? (
            <CardBody>
              <EmptyState title="No housekeeping staff yet" hint="Add them from Staff & Setup" />
            </CardBody>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs font-medium text-slate-500">
                    <th className="px-5 py-3">Housekeeper</th>
                    <th className="px-5 py-3">Today</th>
                    <th className="px-5 py-3">All-time</th>
                    <th className="px-5 py-3">Last cleaning</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {stats.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3 font-medium text-slate-900">{s.name}</td>
                      <td className="px-5 py-3 text-slate-700">{s.cleaningsToday}</td>
                      <td className="px-5 py-3 text-slate-500">{s.cleaningsTotal}</td>
                      <td className="px-5 py-3 text-slate-500">
                        {s.lastCleaningAt ? (
                          <>
                            Room {s.lastRoomNumber} · {new Date(s.lastCleaningAt).toLocaleString()}
                            {s.lastFlagged && (
                              <span className="ml-1.5">
                                <Badge tone="flagged">flagged</Badge>
                              </span>
                            )}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <Card>
        <CardHeader title="Cleaning history" />
        {records.length === 0 ? (
          <CardBody>
            <EmptyState title="No cleanings submitted yet" />
          </CardBody>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-medium text-slate-500">
                  <th className="px-5 py-3">Room</th>
                  <th className="px-5 py-3">Kind</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Resolved</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {records.map((r) => (
                  <tr key={r.id} className={r.flagged && !r.resolvedAt ? 'bg-red-50/60' : 'hover:bg-slate-50'}>
                    <td className="px-5 py-3 font-medium text-slate-900">{rooms.find((rm) => rm.id === r.roomId)?.roomNumber ?? r.roomId}</td>
                    <td className="px-5 py-3 text-slate-500">{r.kind}</td>
                    <td className="px-5 py-3">{r.flagged ? <Badge tone="flagged">no-guest discrepancy</Badge> : <Badge tone="available">ok</Badge>}</td>
                    <td className="px-5 py-3 text-slate-500">{r.resolvedAt ? r.resolvedNote ?? 'resolved' : '—'}</td>
                    <td className="px-5 py-3 text-right">
                      {r.flagged && !r.resolvedAt && canResolve && (
                        <button onClick={() => resolve(r.id)} className="text-xs font-medium text-brand-600 hover:underline">
                          Resolve
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
