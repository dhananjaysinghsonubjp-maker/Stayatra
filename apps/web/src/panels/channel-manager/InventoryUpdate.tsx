import { useEffect, useState } from 'react';
import { mutate, query, ApiError } from '../../api';
import { useAuth } from '../../AuthContext';
import { Button, Card, CardBody, CardHeader, Field, PageHeader, Toggle, inputClass } from '../../components/ui';
import { ChannelMultiSelect } from './ChannelMultiSelect';
import type { OtaConnection, RatePlan, RoomCategory } from '../../types';

const DOW = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DOW_VALUE = [1, 2, 3, 4, 5, 6, 0];

function todayPlus(days: number) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

/** §7 Phase 1 #2 — availability-only half of Bulk Update: leaves prices untouched (rates.service.ts's upsertBulkCell merges whichever half is omitted). */
export function InventoryUpdate({ hotelId }: { hotelId: string }) {
  const { token } = useAuth();
  const [connections, setConnections] = useState<OtaConnection[]>([]);
  const [ratePlans, setRatePlans] = useState<RatePlan[]>([]);
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);
  const [startDate, setStartDate] = useState(todayPlus(0));
  const [endDate, setEndDate] = useState(todayPlus(6));
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5, 6, 0]);
  const [availability, setAvailability] = useState<Record<string, string>>({});
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    async function load() {
      const [c, rp] = await Promise.all([
        query<OtaConnection[]>('ota.listConnections', { hotelId }, token ?? undefined),
        query<RatePlan[]>('rates.listAllRatePlansForHotel', { hotelId }, token ?? undefined),
      ]);
      setConnections(c);
      setRatePlans(rp);
    }
    void load();
  }, [hotelId, token]);

  function toggleDay(value: number) {
    setDays((prev) => (prev.includes(value) ? prev.filter((x) => x !== value) : [...prev, value]));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (selectedChannelIds.length === 0) {
      setError('Select at least one channel');
      return;
    }
    const activeRows = Object.entries(availability).filter(([, v]) => v !== '' && v !== undefined);
    if (activeRows.length === 0) {
      setError('Enter room availability for at least one room to update');
      return;
    }
    setBusy(true);
    try {
      let cellsUpdated = 0;
      for (const [ratePlanId, value] of activeRows) {
        // Tiers 1 and 2 share the same availability count — a room is either free or not, regardless of how many guests occupy it.
        const explicitTiers = [1, 2].map((occupancyTier) => ({ occupancyTier, availability: Number(value) }));
        for (const otaConnectionId of selectedChannelIds) {
          const res = await mutate<{ cellsUpdated: number }>(
            'rates.bulkUpdate',
            { ratePlanId, otaConnectionId, startDate, endDate, daysOfWeek: days.length === 7 ? undefined : days, explicitTiers },
            token ?? undefined,
          );
          cellsUpdated += res.cellsUpdated;
        }
      }
      setResult(`Updated ${cellsUpdated} cells across ${activeRows.length} rate plan(s) and ${selectedChannelIds.length} channel(s).`);
      setAvailability({});
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Inventory update failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader title="Inventory Update" subtitle="Availability only — prices are set separately on Rate Update." />

      <Card className="mb-6">
        <CardBody className="space-y-5">
          <div>
            <p className="mb-2 text-xs font-medium text-slate-600">Channels</p>
            <ChannelMultiSelect connections={connections} selected={selectedChannelIds} onChange={setSelectedChannelIds} />
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Field label="From Date">
              <input className={inputClass} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
            <Field label="To Date">
              <input className={inputClass} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
            {DOW.map((label, i) => (
              <Toggle key={label} checked={days.includes(DOW_VALUE[i])} onChange={() => toggleDay(DOW_VALUE[i])} label={label} />
            ))}
          </div>
        </CardBody>
      </Card>

      <form onSubmit={submit} className="space-y-3">
        {ratePlans.length === 0 ? (
          <Card className="p-6 text-center text-sm text-slate-400">No rate plans yet — create one on Linked Rate Plan first.</Card>
        ) : (
          ratePlans.map((rp) => (
            <Card key={rp.id} className="p-4">
              <div className="flex items-center justify-between gap-4">
                <p className="text-sm font-semibold text-slate-900">
                  {rp.roomCategoryName} <span className="font-normal text-slate-500">({rp.name}{rp.mealPlan ? `, ${rp.mealPlan}` : ''})</span>
                </p>
                <div className="w-48">
                  <input
                    className={inputClass}
                    type="number"
                    min={0}
                    placeholder="Room availability"
                    value={availability[rp.id] ?? ''}
                    onChange={(e) => setAvailability((prev) => ({ ...prev, [rp.id]: e.target.value }))}
                  />
                </div>
              </div>
            </Card>
          ))
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
        {result && <p className="text-sm text-emerald-600">{result}</p>}
        {ratePlans.length > 0 && (
          <Button type="submit" disabled={busy}>
            {busy ? 'Applying…' : 'Apply inventory update'}
          </Button>
        )}
      </form>

      <div className="mt-8">
        <WalkInRoomBlock hotelId={hotelId} />
      </div>
    </div>
  );
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

interface RoomBlockRow {
  id: string;
  roomCategoryId: string;
  roomCategory: { name: string };
  startDate: string;
  endDate: string;
  roomsBlocked: number;
  reason: string | null;
}

/**
 * Walk-in inventory holdback (§ user request) — a walk-in guest taken straight at the front
 * desk gets no booking record or guest details here, just a quantity pulled out of the shared
 * availability pool so other channels can't oversell the same physical rooms. Deliberately
 * separate from PMS's own walk-in check-in flow, which does create a real guest/booking record.
 */
function WalkInRoomBlock({ hotelId }: { hotelId: string }) {
  const { token } = useAuth();
  const [categories, setCategories] = useState<RoomCategory[]>([]);
  const [blocks, setBlocks] = useState<RoomBlockRow[]>([]);
  const [roomCategoryId, setRoomCategoryId] = useState('');
  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState(todayPlus(1));
  const [roomsBlocked, setRoomsBlocked] = useState(1);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const [c, b] = await Promise.all([
      query<RoomCategory[]>('hotels.listRoomCategories', { hotelId }, token ?? undefined),
      query<RoomBlockRow[]>('rates.listRoomBlocks', { hotelId }, token ?? undefined),
    ]);
    setCategories(c);
    setBlocks(b);
    if (!roomCategoryId && c[0]) setRoomCategoryId(c[0].id);
  }
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await mutate(
        'rates.createRoomBlock',
        { hotelId, roomCategoryId, startDate, endDate, roomsBlocked, reason: reason.trim() || undefined },
        token ?? undefined,
      );
      setReason('');
      setRoomsBlocked(1);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to block rooms');
    } finally {
      setBusy(false);
    }
  }

  async function release(blockId: string) {
    await mutate('rates.releaseRoomBlock', { roomBlockId: blockId }, token ?? undefined);
    await refresh();
  }

  if (categories.length === 0) return null;

  return (
    <Card>
      <CardHeader
        title="Walk-in / Manual Room Block"
        subtitle="A walk-in guest taken at the desk — no booking or guest details here, just fewer rooms shown as available to every channel."
      />
      <CardBody>
        <form onSubmit={submit} className="grid grid-cols-2 gap-4 sm:grid-cols-5 sm:items-end">
          <Field label="Room category">
            <select className={inputClass} value={roomCategoryId} onChange={(e) => setRoomCategoryId(e.target.value)}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="From">
            <input className={inputClass} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label="To">
            <input className={inputClass} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
          <Field label="Rooms to block">
            <input
              className={inputClass}
              type="number"
              min={1}
              value={roomsBlocked}
              onChange={(e) => setRoomsBlocked(Number(e.target.value))}
            />
          </Field>
          <Button type="submit" disabled={busy}>
            {busy ? 'Blocking…' : 'Block rooms'}
          </Button>
          <div className="col-span-2 sm:col-span-5">
            <Field label="Reason (optional)">
              <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Walk-in guest" />
            </Field>
          </div>
        </form>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

        {blocks.length > 0 && (
          <div className="mt-5 divide-y divide-slate-100 border-t border-slate-100">
            {blocks.map((b) => (
              <div key={b.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="text-sm">
                  <span className="font-medium text-slate-900">{b.roomCategory.name}</span>
                  <span className="text-slate-500">
                    {' '}
                    · {b.roomsBlocked} room{b.roomsBlocked === 1 ? '' : 's'} · {b.startDate.slice(0, 10)} → {b.endDate.slice(0, 10)}
                  </span>
                  {b.reason && <span className="text-slate-400"> · {b.reason}</span>}
                </div>
                <button onClick={() => void release(b.id)} className="shrink-0 text-xs font-medium text-brand-600 hover:underline">
                  Release
                </button>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
