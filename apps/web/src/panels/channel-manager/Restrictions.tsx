import { useEffect, useState } from 'react';
import { mutate, query, ApiError } from '../../api';
import { useAuth } from '../../AuthContext';
import { Button, Card, CardBody, CardHeader, Field, PageHeader, inputClass } from '../../components/ui';
import { CmFilterBar } from './CmFilterBar';
import { useCmSelection } from './useCmSelection';
import type { Restriction as RestrictionRow } from '../../types';

/** §7 Phase 1 #4 / §10's two visual tiers — Block Channel prominent; MLOS/CTA/CTD one level down; the rest behind Advanced. */
export function Restrictions({ hotelId }: { hotelId: string }) {
  const { token } = useAuth();
  const cm = useCmSelection(hotelId);
  const [restrictions, setRestrictions] = useState<RestrictionRow[]>([]);
  const [date, setDate] = useState(cm.startDate);
  const [channelBlocked, setChannelBlocked] = useState(false);
  const [ratePlanClosed, setRatePlanClosed] = useState(false);
  const [closedToArrival, setClosedToArrival] = useState(false);
  const [closedToDeparture, setClosedToDeparture] = useState(false);
  const [minLos, setMinLos] = useState('');
  const [maxLos, setMaxLos] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [bookableNights, setBookableNights] = useState('');
  const [minAdvanceDays, setMinAdvanceDays] = useState('');
  const [maxAdvanceDays, setMaxAdvanceDays] = useState('');
  const [policyOverrideId, setPolicyOverrideId] = useState('');
  const [minLosArrival, setMinLosArrival] = useState('');
  const [maxLosArrival, setMaxLosArrival] = useState('');
  const [exactLosArrival, setExactLosArrival] = useState('');
  const [cap, setCap] = useState('');
  const [cutoffHours, setCutoffHours] = useState('');
  const [allocationCount, setAllocationCount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function refresh() {
    if (!cm.ratePlanId || !cm.otaConnectionId) return;
    const grid = await query<{ restrictions: RestrictionRow[] }>(
      'rates.getGrid',
      { ratePlanId: cm.ratePlanId, otaConnectionId: cm.otaConnectionId, startDate: cm.startDate, endDate: cm.endDate },
      token ?? undefined,
    );
    setRestrictions(grid.restrictions);
  }
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cm.ratePlanId, cm.otaConnectionId, cm.startDate, cm.endDate]);

  const existing = restrictions.find((r) => r.date.slice(0, 10) === date);

  useEffect(() => {
    setChannelBlocked(existing?.channelBlocked ?? false);
    setRatePlanClosed(existing?.ratePlanClosed ?? false);
    setClosedToArrival(existing?.closedToArrival ?? false);
    setClosedToDeparture(existing?.closedToDeparture ?? false);
    setMinLos(existing?.minLos?.toString() ?? '');
    setMaxLos(existing?.maxLos?.toString() ?? '');
    setBookableNights(existing?.bookableNights?.toString() ?? '');
    setMinAdvanceDays(existing?.minAdvanceDays?.toString() ?? '');
    setMaxAdvanceDays(existing?.maxAdvanceDays?.toString() ?? '');
    setPolicyOverrideId(existing?.policyOverrideId ?? '');
    setMinLosArrival(existing?.minLosArrival?.toString() ?? '');
    setMaxLosArrival(existing?.maxLosArrival?.toString() ?? '');
    setExactLosArrival(existing?.exactLosArrival?.toString() ?? '');
    setCap(existing?.cap?.toString() ?? '');
    setCutoffHours(existing?.cutoffHours?.toString() ?? '');
    setAllocationCount(existing?.allocationCount?.toString() ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, restrictions]);

  // Separate on purpose — a successful save triggers refresh() -> a new
  // `restrictions` array reference, which would otherwise re-run the effect
  // above and clobber the confirmation before it's ever seen.
  useEffect(() => {
    setSaved(false);
  }, [date]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!cm.ratePlanId || !cm.otaConnectionId) {
      setError('Select a room category, rate plan, and channel above first');
      return;
    }
    try {
      await mutate(
        'rates.upsertRestriction',
        {
          ratePlanId: cm.ratePlanId,
          otaConnectionId: cm.otaConnectionId,
          date,
          channelBlocked,
          ratePlanClosed,
          closedToArrival,
          closedToDeparture,
          minLos: minLos ? Number(minLos) : undefined,
          maxLos: maxLos ? Number(maxLos) : undefined,
          bookableNights: bookableNights ? Number(bookableNights) : undefined,
          minAdvanceDays: minAdvanceDays ? Number(minAdvanceDays) : undefined,
          maxAdvanceDays: maxAdvanceDays ? Number(maxAdvanceDays) : undefined,
          policyOverrideId: policyOverrideId || undefined,
          minLosArrival: minLosArrival ? Number(minLosArrival) : undefined,
          maxLosArrival: maxLosArrival ? Number(maxLosArrival) : undefined,
          exactLosArrival: exactLosArrival ? Number(exactLosArrival) : undefined,
          cap: cap ? Number(cap) : undefined,
          cutoffHours: cutoffHours ? Number(cutoffHours) : undefined,
          allocationCount: allocationCount ? Number(allocationCount) : undefined,
        },
        token ?? undefined,
      );
      setSaved(true);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save restriction');
    }
  }

  return (
    <div>
      <PageHeader title="Update Restrictions" subtitle="Block Channel, MLOS, CTA/CTD, and advance-booking rules per date (§7 Phase 1 #4)." />
      <CmFilterBar cm={cm} />

      <Card>
        <CardHeader title="Restrictions" subtitle="Block Channel is the default, prominent toggle — everything else sits progressively deeper (§10)." />
        <CardBody>
          <form onSubmit={submit} className="space-y-4">
            <Field label="Date">
              <input className={inputClass} type="date" value={date} min={cm.startDate} max={cm.endDate} onChange={(e) => setDate(e.target.value)} />
            </Field>

            <label className="flex items-center justify-between rounded-lg bg-red-50 px-4 py-3">
              <span className="text-sm font-semibold text-red-700">Block Channel (stop sell)</span>
              <input type="checkbox" checked={channelBlocked} onChange={(e) => setChannelBlocked(e.target.checked)} className="h-5 w-5 rounded border-slate-300 text-red-600 focus:ring-red-500" />
            </label>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={ratePlanClosed} onChange={(e) => setRatePlanClosed(e.target.checked)} className="rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
                Close rate plan
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={closedToArrival} onChange={(e) => setClosedToArrival(e.target.checked)} className="rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
                Closed to arrival
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={closedToDeparture} onChange={(e) => setClosedToDeparture(e.target.checked)} className="rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
                Closed to departure
              </label>
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Field label="Min length of stay">
                <input className={inputClass} type="number" min={0} value={minLos} onChange={(e) => setMinLos(e.target.value)} placeholder="—" />
              </Field>
              <Field label="Max length of stay">
                <input className={inputClass} type="number" min={0} value={maxLos} onChange={(e) => setMaxLos(e.target.value)} placeholder="—" />
              </Field>
            </div>

            <button type="button" onClick={() => setShowAdvanced((v) => !v)} className="text-xs font-medium text-brand-600 hover:underline">
              {showAdvanced ? 'Hide advanced' : 'Advanced ▸'}
            </button>
            {showAdvanced && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  <Field label="Bookable nights">
                    <input className={inputClass} type="number" min={0} value={bookableNights} onChange={(e) => setBookableNights(e.target.value)} placeholder="—" />
                  </Field>
                  <Field label="Min advance days">
                    <input className={inputClass} type="number" min={0} value={minAdvanceDays} onChange={(e) => setMinAdvanceDays(e.target.value)} placeholder="—" />
                  </Field>
                  <Field label="Max advance days">
                    <input className={inputClass} type="number" min={0} value={maxAdvanceDays} onChange={(e) => setMaxAdvanceDays(e.target.value)} placeholder="—" />
                  </Field>
                  <Field label="Policy override reference">
                    <input className={inputClass} value={policyOverrideId} onChange={(e) => setPolicyOverrideId(e.target.value)} placeholder="e.g. a named policy's id" />
                  </Field>
                </div>

                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Arrival-conditioned length of stay</p>
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                    <Field label="Min LOS on arrival">
                      <input className={inputClass} type="number" min={0} value={minLosArrival} onChange={(e) => setMinLosArrival(e.target.value)} placeholder="—" />
                    </Field>
                    <Field label="Max LOS on arrival">
                      <input className={inputClass} type="number" min={0} value={maxLosArrival} onChange={(e) => setMaxLosArrival(e.target.value)} placeholder="—" />
                    </Field>
                    <Field label="Exact LOS on arrival">
                      <input className={inputClass} type="number" min={0} value={exactLosArrival} onChange={(e) => setExactLosArrival(e.target.value)} placeholder="—" />
                    </Field>
                  </div>
                </div>

                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Inventory control (Phase 3)</p>
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                    <Field label="Cap">
                      <input className={inputClass} type="number" min={0} value={cap} onChange={(e) => setCap(e.target.value)} placeholder="—" />
                    </Field>
                    <Field label="Cut-off (hours before arrival)">
                      <input className={inputClass} type="number" min={0} value={cutoffHours} onChange={(e) => setCutoffHours(e.target.value)} placeholder="—" />
                    </Field>
                    <Field label="Allocation">
                      <input className={inputClass} type="number" min={0} value={allocationCount} onChange={(e) => setAllocationCount(e.target.value)} placeholder="—" />
                    </Field>
                  </div>
                </div>
              </div>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}
            {saved && <p className="text-sm text-emerald-600">Restriction saved for {date}.</p>}
            <Button type="submit" variant="secondary">
              Save restriction
            </Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
