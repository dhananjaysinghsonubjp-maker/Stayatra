import { useEffect, useState } from 'react';
import { mutate, query, ApiError } from '../api';
import { useAuth } from '../AuthContext';
import type { InventoryRate, OtaConnection, RatePlan, RoomCategory } from '../types';

const OTA_CODES = ['mmt_goibibo', 'booking_com', 'agoda', 'cleartrip', 'expedia', 'airbnb'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function todayPlus(days: number) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

export function RateGrid({ hotelId }: { hotelId: string }) {
  const { token } = useAuth();
  const [categories, setCategories] = useState<RoomCategory[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [ratePlans, setRatePlans] = useState<RatePlan[]>([]);
  const [ratePlanId, setRatePlanId] = useState('');
  const [connections, setConnections] = useState<OtaConnection[]>([]);
  const [otaConnectionId, setOtaConnectionId] = useState('');
  const [rates, setRates] = useState<InventoryRate[]>([]);
  const [startDate, setStartDate] = useState(todayPlus(0));
  const [endDate, setEndDate] = useState(todayPlus(6));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    query<RoomCategory[]>('hotels.listRoomCategories', { hotelId }, token ?? undefined).then(setCategories);
    query<OtaConnection[]>('ota.listConnections', { hotelId }, token ?? undefined).then(setConnections);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId]);

  useEffect(() => {
    if (!categoryId) {
      setRatePlans([]);
      return;
    }
    query<RatePlan[]>('rates.listRatePlans', { roomCategoryId: categoryId }, token ?? undefined).then(setRatePlans);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId]);

  async function refreshGrid() {
    if (!ratePlanId || !otaConnectionId) return;
    try {
      const grid = await query<{ rates: InventoryRate[] }>(
        'rates.getGrid',
        { ratePlanId, otaConnectionId, startDate, endDate },
        token ?? undefined,
      );
      setRates(grid.rates.filter((r) => r.occupancyTier === 1));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load grid');
    }
  }
  useEffect(() => {
    void refreshGrid();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ratePlanId, otaConnectionId, startDate, endDate]);

  async function addConnection(otaCode: string) {
    await mutate('ota.createConnection', { hotelId, otaCode }, token ?? undefined);
    setConnections(await query<OtaConnection[]>('ota.listConnections', { hotelId }, token ?? undefined));
  }

  async function addRatePlan(name: string) {
    if (!categoryId) return;
    await mutate('rates.createRatePlan', { roomCategoryId: categoryId, name }, token ?? undefined);
    setRatePlans(await query<RatePlan[]>('rates.listRatePlans', { roomCategoryId: categoryId }, token ?? undefined));
  }

  return (
    <div className="card">
      <h3>Channel Manager — Rate Grid</h3>
      <p className="hint">Simulator shows occupancy tier 1 only; the API supports tiers 1–4 + extra adult/children.</p>

      <div className="grid-controls">
        <label>
          Room category
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">— select —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Rate plan
          <select value={ratePlanId} onChange={(e) => setRatePlanId(e.target.value)} disabled={!categoryId}>
            <option value="">— select —</option>
            {ratePlans.map((rp) => (
              <option key={rp.id} value={rp.id}>
                {rp.name}
              </option>
            ))}
          </select>
        </label>
        <button disabled={!categoryId} onClick={() => addRatePlan(prompt('Rate plan name?', 'BAR') || '')}>
          + New rate plan
        </button>

        <label>
          OTA connection
          <select value={otaConnectionId} onChange={(e) => setOtaConnectionId(e.target.value)}>
            <option value="">— select —</option>
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.otaCode} ({c.status})
              </option>
            ))}
          </select>
        </label>
        <select onChange={(e) => e.target.value && addConnection(e.target.value)} value="">
          <option value="">+ Connect a channel…</option>
          {OTA_CODES.filter((c) => !connections.some((x) => x.otaCode === c)).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {otaConnectionId && <FullSyncButton otaConnectionId={otaConnectionId} onRefreshConnections={async () => setConnections(await query<OtaConnection[]>('ota.listConnections', { hotelId }, token ?? undefined))} />}

        <label>
          From
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </label>
      </div>

      {error && <p className="error">{error}</p>}

      {ratePlanId && otaConnectionId && (
        <>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Price</th>
                <th>Availability</th>
                <th>Source</th>
                <th>GST</th>
              </tr>
            </thead>
            <tbody>
              {rates.map((r) => (
                <tr key={r.id}>
                  <td>{r.date.slice(0, 10)}</td>
                  <td>₹{r.price}</td>
                  <td>{r.availability}</td>
                  <td>
                    <span className={`tag tag-${r.source}`}>{r.source}</span>
                  </td>
                  <td>{r.gst.label}</td>
                </tr>
              ))}
              {rates.length === 0 && (
                <tr>
                  <td colSpan={5} className="hint">
                    No rates set for this range yet — use Bulk Update below.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <BulkUpdateForm ratePlanId={ratePlanId} otaConnectionId={otaConnectionId} onDone={refreshGrid} />
          <ValueOverrideForm ratePlanId={ratePlanId} otaConnectionId={otaConnectionId} onDone={refreshGrid} />
        </>
      )}
    </div>
  );
}

function BulkUpdateForm({
  ratePlanId,
  otaConnectionId,
  onDone,
}: {
  ratePlanId: string;
  otaConnectionId: string;
  onDone: () => void;
}) {
  const { token } = useAuth();
  const [startDate, setStartDate] = useState(todayPlus(0));
  const [endDate, setEndDate] = useState(todayPlus(6));
  const [days, setDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [price, setPrice] = useState(3000);
  const [availability, setAvailability] = useState(5);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggleDay(d: number) {
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await mutate<{ datesProcessed: number; cellsUpdated: number; cellsSkippedValueOverride: number }>(
        'rates.bulkUpdate',
        {
          ratePlanId,
          otaConnectionId,
          startDate,
          endDate,
          daysOfWeek: days.length === 7 ? undefined : days,
          explicitTiers: [{ occupancyTier: 1, price, availability }],
        },
        token ?? undefined,
      );
      setResult(`Updated ${res.cellsUpdated} cells across ${res.datesProcessed} dates (${res.cellsSkippedValueOverride} skipped — value override)`);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Bulk update failed');
    }
  }

  return (
    <form onSubmit={submit} className="card nested">
      <h4>Bulk Update</h4>
      <div className="grid-controls">
        <label>
          From
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </label>
        <label>
          Price (tier 1)
          <input type="number" value={price} onChange={(e) => setPrice(Number(e.target.value))} min={0} />
        </label>
        <label>
          Availability
          <input type="number" value={availability} onChange={(e) => setAvailability(Number(e.target.value))} min={0} />
        </label>
      </div>
      <div className="dow-row">
        {DOW.map((label, i) => (
          <label key={i} className="dow-check">
            <input type="checkbox" checked={days.includes(i)} onChange={() => toggleDay(i)} />
            {label}
          </label>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      {result && <p className="hint">{result}</p>}
      <button type="submit">Apply bulk update</button>
    </form>
  );
}

function ValueOverrideForm({
  ratePlanId,
  otaConnectionId,
  onDone,
}: {
  ratePlanId: string;
  otaConnectionId: string;
  onDone: () => void;
}) {
  const { token } = useAuth();
  const [date, setDate] = useState(todayPlus(2));
  const [price, setPrice] = useState(8500);
  const [availability, setAvailability] = useState(3);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);
    try {
      await mutate(
        'rates.setValueOverride',
        { ratePlanId, otaConnectionId, date, tiers: [{ occupancyTier: 1, price, availability }] },
        token ?? undefined,
      );
      setDone(true);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Value override failed');
    }
  }

  return (
    <form onSubmit={submit} className="card nested">
      <h4>Value Override</h4>
      <p className="hint">A one-time rate float — bulk updates skip this cell until explicitly told to override it.</p>
      <div className="grid-controls">
        <label>
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          Price (tier 1)
          <input type="number" value={price} onChange={(e) => setPrice(Number(e.target.value))} min={0} />
        </label>
        <label>
          Availability
          <input type="number" value={availability} onChange={(e) => setAvailability(Number(e.target.value))} min={0} />
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      {done && <p className="hint">Override applied.</p>}
      <button type="submit">Set value override</button>
    </form>
  );
}

function FullSyncButton({ otaConnectionId, onRefreshConnections }: { otaConnectionId: string; onRefreshConnections: () => void }) {
  const { token } = useAuth();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      await mutate('ota.fullSync', { otaConnectionId }, token ?? undefined);
      // the job runs async — poll a few times so the status badge catches up
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 500));
        onRefreshConnections();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" onClick={run} disabled={busy}>
      {busy ? 'Syncing…' : 'Full Sync'}
    </button>
  );
}
