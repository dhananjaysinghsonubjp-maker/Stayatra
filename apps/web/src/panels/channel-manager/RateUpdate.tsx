import { useEffect, useState } from 'react';
import { mutate, query, ApiError } from '../../api';
import { useAuth } from '../../AuthContext';
import { Button, Card, CardBody, Field, PageHeader, Toggle, inputClass } from '../../components/ui';
import { ChannelMultiSelect } from './ChannelMultiSelect';
import type { OtaConnection, RatePlan } from '../../types';

const DOW = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DOW_VALUE = [1, 2, 3, 4, 5, 6, 0]; // Mon-first display, mapped to JS getUTCDay() (0=Sun)

function todayPlus(days: number) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

interface RowValues {
  onePax: string;
  twoPax: string;
  extraAdult: string;
  child1: string;
  child2: string;
}

/** §7 Phase 1 #2 — rate-only half of Bulk Update: every rate plan across every room category, one row each, applied across every selected channel at once. */
export function RateUpdate({ hotelId }: { hotelId: string }) {
  const { token } = useAuth();
  const [connections, setConnections] = useState<OtaConnection[]>([]);
  const [ratePlans, setRatePlans] = useState<RatePlan[]>([]);
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);
  const [startDate, setStartDate] = useState(todayPlus(0));
  const [endDate, setEndDate] = useState(todayPlus(6));
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5, 6, 0]);
  const [rows, setRows] = useState<Record<string, RowValues>>({});
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

  function setRowField(ratePlanId: string, field: keyof RowValues, value: string) {
    setRows((prev) => ({ ...prev, [ratePlanId]: { ...emptyRow(prev[ratePlanId]), [field]: value } }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (selectedChannelIds.length === 0) {
      setError('Select at least one channel');
      return;
    }
    const activeRows = Object.entries(rows).filter(([, v]) => v.onePax || v.twoPax);
    if (activeRows.length === 0) {
      setError('Enter at least a "1 Pax" price for one room to update');
      return;
    }
    setBusy(true);
    try {
      let cellsUpdated = 0;
      for (const [ratePlanId, v] of activeRows) {
        const explicitTiers = [];
        if (v.onePax) {
          explicitTiers.push({
            occupancyTier: 1,
            price: Number(v.onePax),
            extraAdultPrice: v.extraAdult ? Number(v.extraAdult) : undefined,
            child1Price: v.child1 ? Number(v.child1) : undefined,
            child2Price: v.child2 ? Number(v.child2) : undefined,
          });
        }
        if (v.twoPax) {
          explicitTiers.push({
            occupancyTier: 2,
            price: Number(v.twoPax),
            extraAdultPrice: v.extraAdult ? Number(v.extraAdult) : undefined,
            child1Price: v.child1 ? Number(v.child1) : undefined,
            child2Price: v.child2 ? Number(v.child2) : undefined,
          });
        }
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
      setRows({});
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Rate update failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader title="Rate Update" subtitle="Prices only — availability is set separately on Inventory Update." />

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
              <p className="mb-3 text-sm font-semibold text-slate-900">
                {rp.roomCategoryName} <span className="font-normal text-slate-500">({rp.name}{rp.mealPlan ? `, ${rp.mealPlan}` : ''})</span>
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <Field label="1 Pax">
                  <input className={inputClass} type="number" min={0} placeholder="—" value={rows[rp.id]?.onePax ?? ''} onChange={(e) => setRowField(rp.id, 'onePax', e.target.value)} />
                </Field>
                <Field label="2 Pax">
                  <input className={inputClass} type="number" min={0} placeholder="—" value={rows[rp.id]?.twoPax ?? ''} onChange={(e) => setRowField(rp.id, 'twoPax', e.target.value)} />
                </Field>
                <Field label="Extra Adult">
                  <input className={inputClass} type="number" min={0} placeholder="—" value={rows[rp.id]?.extraAdult ?? ''} onChange={(e) => setRowField(rp.id, 'extraAdult', e.target.value)} />
                </Field>
                <Field label="Child 1">
                  <input className={inputClass} type="number" min={0} placeholder="—" value={rows[rp.id]?.child1 ?? ''} onChange={(e) => setRowField(rp.id, 'child1', e.target.value)} />
                </Field>
                <Field label="Child 2">
                  <input className={inputClass} type="number" min={0} placeholder="—" value={rows[rp.id]?.child2 ?? ''} onChange={(e) => setRowField(rp.id, 'child2', e.target.value)} />
                </Field>
              </div>
            </Card>
          ))
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
        {result && <p className="text-sm text-emerald-600">{result}</p>}
        {ratePlans.length > 0 && (
          <Button type="submit" disabled={busy}>
            {busy ? 'Applying…' : 'Apply rate update'}
          </Button>
        )}
      </form>
    </div>
  );
}

function emptyRow(row?: RowValues): RowValues {
  return row ?? { onePax: '', twoPax: '', extraAdult: '', child1: '', child2: '' };
}
