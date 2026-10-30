import { useEffect, useState } from 'react';
import { mutate, query, ApiError } from '../../api';
import { useAuth } from '../../AuthContext';
import { Button, Card, CardBody, CardHeader, Field, PageHeader, inputClass } from '../../components/ui';
import { CmFilterBar } from './CmFilterBar';
import { OTA_LABEL } from './ota-labels';
import { useCmSelection, type CmSelection } from './useCmSelection';
import type { ActiveOverrideRow, ActiveRestrictionRow, InventoryRate } from '../../types';

// Labeled by guest count, not "Tier N" (§ user request) — that's what these actually mean,
// and 2 guests is the common default occupancy a room is priced/booked for.
const TIERS: { value: number; label: string }[] = [
  { value: 1, label: '1 Guest' },
  { value: 2, label: '2 Guests' },
  { value: 3, label: '3 Guests' },
  { value: 4, label: '4 Guests' },
];
const DEFAULT_OCCUPANCY_TIER = 2;

/**
 * §7 Phase 1 #3/#4 (§ user request) — a one-time price/availability float for one date on
 * one channel, with Availability 0 doubling as the stop-sell switch (writes a Restriction
 * row under the hood, same as before). The full Booking Restrictions form — MLOS, CTA/CTD,
 * advance-booking windows, Phase 3 cap/cutoff/allocation — was removed from here on purpose
 * (§ user request: too advanced for now); those columns still exist and `rates.upsertRestriction`
 * still accepts them, so nothing stops a future "Advanced Restrictions" page from reusing this
 * exact data if that need comes back.
 */
export function AdvanceBulkUpdate({ hotelId }: { hotelId: string }) {
  const { token } = useAuth();
  const cm = useCmSelection(hotelId);
  const [date, setDate] = useState(cm.startDate);
  const [refreshKey, setRefreshKey] = useState(0);
  const bumpRefresh = () => setRefreshKey((k) => k + 1);

  // Clicking a row in "Upcoming Overrides" below needs to land on its exact room category,
  // rate plan, and channel up here — but picking a category resets ratePlanId (on purpose,
  // see useCmSelection) and only fills in that category's rate plans a moment later, so the
  // rate plan/channel half of the jump has to wait for that list before it can land safely.
  const [pendingOpen, setPendingOpen] = useState<{ ratePlanId: string; otaConnectionId: string; date: string } | null>(null);
  useEffect(() => {
    if (pendingOpen && cm.ratePlans.some((rp) => rp.id === pendingOpen.ratePlanId)) {
      cm.setRatePlanId(pendingOpen.ratePlanId);
      cm.setOtaConnectionId(pendingOpen.otaConnectionId);
      setDate(pendingOpen.date);
      setPendingOpen(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cm.ratePlans, pendingOpen]);

  function openRow(row: { roomCategoryId: string; ratePlanId: string; otaConnectionId: string; date: string }) {
    cm.setCategoryId(row.roomCategoryId);
    setPendingOpen({ ratePlanId: row.ratePlanId, otaConnectionId: row.otaConnectionId, date: row.date });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <div>
      <PageHeader
        title="Advance Update"
        subtitle="A one-time price/availability override for one date on one channel — set Availability to 0 to block that channel for the date too."
      />
      <CmFilterBar cm={cm} showDates={false} />

      <Card className="mb-6">
        <CardBody>
          <Field label="Date">
            <input className={inputClass} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </CardBody>
      </Card>

      <div className="space-y-6">
        <PricingSection cm={cm} date={date} token={token} onChanged={bumpRefresh} />
        <UpcomingOverridesSection hotelId={hotelId} token={token} refreshKey={refreshKey} onOpen={openRow} />
      </div>
    </div>
  );
}

function PricingSection({ cm, date, token, onChanged }: { cm: CmSelection; date: string; token: string | null; onChanged: () => void }) {
  const [occupancyTier, setOccupancyTier] = useState(DEFAULT_OCCUPANCY_TIER);
  const [existing, setExisting] = useState<InventoryRate | null>(null);
  const [price, setPrice] = useState(8500);
  const [extraAdultPrice, setExtraAdultPrice] = useState('');
  const [child1Price, setChild1Price] = useState('');
  const [child2Price, setChild2Price] = useState('');
  const [availability, setAvailability] = useState(3);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [clearing, setClearing] = useState(false);

  async function refresh() {
    if (!cm.ratePlanId || !cm.otaConnectionId) {
      setExisting(null);
      return;
    }
    const grid = await query<{ rates: InventoryRate[] }>(
      'rates.getGrid',
      { ratePlanId: cm.ratePlanId, otaConnectionId: cm.otaConnectionId, startDate: date, endDate: date },
      token ?? undefined,
    );
    setExisting(grid.rates.find((r) => r.date.slice(0, 10) === date && r.occupancyTier === occupancyTier) ?? null);
  }
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cm.ratePlanId, cm.otaConnectionId, date, occupancyTier]);

  // Pre-fill from whatever is already set for this exact tier/date/channel, same as Restrictions
  // does — a blank 8500/3 every time (the old behavior) looked like a guess, not real data.
  useEffect(() => {
    setPrice(existing ? Number(existing.price) : 8500);
    setExtraAdultPrice(existing?.extraAdultPrice ?? '');
    setChild1Price(existing?.child1Price ?? '');
    setChild2Price(existing?.child2Price ?? '');
    setAvailability(existing ? existing.availability : 3);
  }, [existing]);

  const isOverride = existing?.source === 'value_override';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);
    if (!cm.ratePlanId || !cm.otaConnectionId) {
      setError('Select a room category, rate plan, and channel above first');
      return;
    }
    try {
      await mutate(
        'rates.setValueOverride',
        {
          ratePlanId: cm.ratePlanId,
          otaConnectionId: cm.otaConnectionId,
          date,
          tiers: [
            {
              occupancyTier,
              price,
              extraAdultPrice: extraAdultPrice ? Number(extraAdultPrice) : undefined,
              child1Price: child1Price ? Number(child1Price) : undefined,
              child2Price: child2Price ? Number(child2Price) : undefined,
              availability,
            },
          ],
          // §bugfix — "booking.com block karna hai, baaki OTA pe sell hota rahe": this whole
          // screen's point is a SINGLE channel's own override, including setting its availability
          // to 0 to stop-sell just that one — setValueOverride's default pool-wide fan-out would
          // have silently zeroed every other connected channel's availability too. See that
          // function's own comment for the full story.
          fanOutAvailability: false,
        },
        token ?? undefined,
      );
      // § user request — "availability 0 toh automatically block ho jana chahiye", folded into
      // this same save instead of a separate warning telling the owner to go do it by hand.
      // Symmetric both ways: raising availability back above 0 here reopens the channel too, so
      // this one field stays the single on/off lever instead of two places drifting out of sync.
      await mutate(
        'rates.upsertRestriction',
        { ratePlanId: cm.ratePlanId, otaConnectionId: cm.otaConnectionId, date, channelBlocked: availability === 0 },
        token ?? undefined,
      );
      setDone(true);
      await refresh();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Value override failed');
    }
  }

  async function clearOverride() {
    if (!cm.ratePlanId || !cm.otaConnectionId) return;
    setClearing(true);
    setError(null);
    try {
      const wasZeroAvailability = existing?.availability === 0;
      await mutate('rates.clearValueOverride', { ratePlanId: cm.ratePlanId, otaConnectionId: cm.otaConnectionId, date, occupancyTier }, token ?? undefined);
      // Undo the auto-block from setting availability to 0 too, same symmetry as submit() above.
      if (wasZeroAvailability) {
        await mutate('rates.upsertRestriction', { ratePlanId: cm.ratePlanId, otaConnectionId: cm.otaConnectionId, date, channelBlocked: false }, token ?? undefined);
      }
      setDone(false);
      await refresh();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to clear override');
    } finally {
      setClearing(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Pricing & Availability" subtitle="A one-time price/availability float for this date — bulk updates skip it until explicitly told to override." />
      <CardBody>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field label="Occupancy">
              <select className={inputClass} value={occupancyTier} onChange={(e) => setOccupancyTier(Number(e.target.value))}>
                {TIERS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] leading-snug text-slate-400">
                Different headcounts can price differently — this sets the rate for that many guests in the room.
              </p>
            </Field>
            <Field label="Availability">
              <input className={inputClass} type="number" value={availability} onChange={(e) => setAvailability(Number(e.target.value))} min={0} />
              <p className="mt-1 text-[11px] leading-snug text-slate-400">
                How many rooms are open to sell on this channel for this date. Setting this to 0 also blocks the channel for this date
                automatically — raising it back above 0 reopens it, so this one field is the single on/off switch.
              </p>
            </Field>
            <Field label="Price">
              <input className={inputClass} type="number" value={price} onChange={(e) => setPrice(Number(e.target.value))} min={0} />
              <p className="mt-1 text-[11px] leading-snug text-slate-400">Per-night rate for this occupancy tier.</p>
            </Field>
            <Field label="+ Adult price">
              <input className={inputClass} type="number" value={extraAdultPrice} onChange={(e) => setExtraAdultPrice(e.target.value)} min={0} placeholder="—" />
            </Field>
            <Field label="Child 1 / Child 2">
              <div className="flex gap-2">
                <input className={inputClass} type="number" value={child1Price} onChange={(e) => setChild1Price(e.target.value)} min={0} placeholder="Child 1" />
                <input className={inputClass} type="number" value={child2Price} onChange={(e) => setChild2Price(e.target.value)} min={0} placeholder="Child 2" />
              </div>
            </Field>
          </div>

          {isOverride && (
            <p className="rounded-md bg-brand-50 px-2.5 py-2 text-xs text-brand-700">
              An override is already set for this exact tier/date/channel — the fields above show it. "Clear override" below removes it
              and lets Rate Update/Inventory Update (or the next bulk edit) govern this cell again.
            </p>
          )}

          {availability === 0 && (
            <p className="rounded-md bg-red-50 px-2.5 py-2 text-xs font-medium text-red-700">
              🔒 Saving with Availability at 0 will also mark this channel Blocked for {date}.
            </p>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
          {done && <p className="text-sm text-emerald-600">Override applied.</p>}
          <div className="flex items-center gap-3">
            <Button type="submit" variant="secondary">
              Set value override
            </Button>
            {isOverride && (
              <button
                type="button"
                onClick={() => void clearOverride()}
                disabled={clearing}
                className="text-sm font-medium text-slate-500 hover:text-red-600 hover:underline disabled:opacity-50"
              >
                {clearing ? 'Clearing…' : 'Clear override'}
              </button>
            )}
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function summarizeRestriction(r: ActiveRestrictionRow): string {
  const parts: string[] = [];
  if (r.channelBlocked) parts.push('Blocked');
  if (r.ratePlanClosed) parts.push('Rate plan closed');
  if (r.closedToArrival) parts.push('Closed to arrival');
  if (r.closedToDeparture) parts.push('Closed to departure');
  if (r.minLos) parts.push(`Min stay ${r.minLos}`);
  if (r.maxLos) parts.push(`Max stay ${r.maxLos}`);
  if (r.bookableNights) parts.push(`Bookable nights ${r.bookableNights}`);
  if (r.minAdvanceDays) parts.push(`Min advance ${r.minAdvanceDays}d`);
  if (r.maxAdvanceDays) parts.push(`Max advance ${r.maxAdvanceDays}d`);
  if (r.cap) parts.push(`Cap ${r.cap}`);
  if (r.cutoffHours) parts.push(`Cutoff ${r.cutoffHours}h`);
  if (r.allocationCount) parts.push(`Allocation ${r.allocationCount}`);
  return parts.join(', ') || 'Restriction set';
}

/**
 * § user request — "ek log mein dikhna chahiye, future dates ke liye, otherwise bhool
 * jaunga." Hotel-wide, not scoped to the filter bar above, since the whole point is
 * surfacing things set elsewhere that are easy to forget about.
 */
interface UpcomingRow {
  id: string;
  date: string;
  roomCategoryId: string;
  ratePlanId: string;
  otaConnectionId: string;
  label: string;
  channel: string;
  what: string;
  override?: ActiveOverrideRow;
  removed?: boolean;
}

interface ActivityRow {
  id: string;
  createdAt: string;
  eventType: 'RATE_VALUE_OVERRIDE' | 'RESTRICTION_UPDATED';
  date: string | null;
  roomCategoryName: string | null;
  ratePlanName: string | null;
  otaCode: string | null;
  cleared: boolean;
  price: number | null;
  availability: number | null;
  channelBlocked: boolean | null;
}

function describeActivity(a: ActivityRow): string {
  if (a.eventType === 'RATE_VALUE_OVERRIDE') {
    return a.cleared ? 'Override cleared' : `Override set: ₹${a.price} · ${a.availability} room${a.availability === 1 ? '' : 's'}`;
  }
  if (a.channelBlocked === true) return 'Channel blocked';
  if (a.channelBlocked === false) return 'Channel unblocked';
  return 'Restriction updated';
}

function UpcomingOverridesSection({
  hotelId,
  token,
  refreshKey,
  onOpen,
}: {
  hotelId: string;
  token: string | null;
  refreshKey: number;
  onOpen: (row: { roomCategoryId: string; ratePlanId: string; otaConnectionId: string; date: string }) => void;
}) {
  const [overrides, setOverrides] = useState<ActiveOverrideRow[]>([]);
  const [restrictions, setRestrictions] = useState<ActiveRestrictionRow[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [activity, setActivity] = useState<ActivityRow[] | null>(null);
  // Rows just removed in this session, kept around (greyed out) instead of vanishing the
  // instant the backend call succeeds — § user request: "Remove" should still show what
  // used to be there, not erase it from view entirely. A real refetch naturally drops these
  // from `overrides`/`restrictions` since they're no longer active; this is what keeps them
  // visible anyway until the page is left.
  const [removedRows, setRemovedRows] = useState<UpcomingRow[]>([]);

  async function refresh() {
    const data = await query<{ overrides: ActiveOverrideRow[]; restrictions: ActiveRestrictionRow[] }>(
      'rates.listActiveOverrides',
      { hotelId },
      token ?? undefined,
    );
    setOverrides(data.overrides);
    setRestrictions(data.restrictions);
    // Keep history in sync with every save/clear too, but only if it's already open —
    // no point fetching 30 days of audit log on every keystroke-triggered refresh otherwise.
    if (historyOpen) await refreshActivity();
  }
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId, refreshKey]);

  async function refreshActivity() {
    setActivity(await query<ActivityRow[]>('rates.listRecentActivity', { hotelId, days: 30 }, token ?? undefined));
  }

  async function toggleHistory() {
    const opening = !historyOpen;
    setHistoryOpen(opening);
    if (opening && activity === null) await refreshActivity();
  }

  async function remove(row: UpcomingRow) {
    if (!row.override) return;
    await mutate(
      'rates.clearValueOverride',
      { ratePlanId: row.override.ratePlan.id, otaConnectionId: row.override.otaConnection.id, date: row.override.date, occupancyTier: row.override.occupancyTier },
      token ?? undefined,
    );
    setRemovedRows((prev) => [...prev, { ...row, removed: true }]);
    await refresh();
  }

  const liveRows: UpcomingRow[] = [
    ...overrides.map((o) => ({
      id: o.id,
      // Trimmed to YYYY-MM-DD here, at the source — the raw ISO timestamp from the API
      // looks fine in the label (which already sliced it) but silently failed to populate
      // the <input type="date"> above when passed straight through on a row click, since
      // that input rejects anything that isn't exactly YYYY-MM-DD and just renders empty.
      date: o.date.slice(0, 10),
      roomCategoryId: o.ratePlan.roomCategory.id,
      ratePlanId: o.ratePlan.id,
      otaConnectionId: o.otaConnection.id,
      label: `${o.ratePlan.roomCategory.name} · ${o.ratePlan.name}`,
      channel: OTA_LABEL[o.otaConnection.otaCode] ?? o.otaConnection.otaCode,
      what: `₹${o.price} · ${o.availability} room${o.availability === 1 ? '' : 's'}`,
      override: o,
    })),
    ...restrictions.map((r) => ({
      id: r.id,
      date: r.date.slice(0, 10),
      roomCategoryId: r.ratePlan.roomCategory.id,
      ratePlanId: r.ratePlan.id,
      otaConnectionId: r.otaConnection.id,
      label: `${r.ratePlan.roomCategory.name} · ${r.ratePlan.name}`,
      channel: OTA_LABEL[r.otaConnection.otaCode] ?? r.otaConnection.otaCode,
      what: summarizeRestriction(r),
    })),
  ];
  const rows: UpcomingRow[] = [...liveRows, ...removedRows.filter((rr) => !liveRows.some((lr) => lr.id === rr.id))].sort((a, b) =>
    a.date.localeCompare(b.date),
  );

  return (
    <Card>
      <CardHeader
        title="Upcoming Overrides & Restrictions"
        subtitle="Tap any row to load it above and edit it — nothing set here gets forgotten."
        action={
          <button
            type="button"
            onClick={() => void toggleHistory()}
            aria-expanded={historyOpen}
            title={historyOpen ? 'Hide last 30 days of activity' : 'Show last 30 days of activity, including anything removed'}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50"
          >
            <span className={`inline-block transition-transform duration-200 ease-in-out ${historyOpen ? 'rotate-90' : ''}`}>▸</span>
          </button>
        }
      />
      <CardBody>
        {rows.length === 0 ? (
          <p className="text-sm text-slate-400">Nothing currently overridden or blocked for today or any future date.</p>
        ) : (
          <div className="-mx-5 -my-4 divide-y divide-slate-100">
            {rows.map((r) => (
              <div
                key={r.id}
                role="button"
                tabIndex={0}
                onClick={() => onOpen(r)}
                onKeyDown={(e) => e.key === 'Enter' && onOpen(r)}
                className={`flex cursor-pointer items-center justify-between gap-3 px-5 py-3 text-left hover:bg-slate-50 ${r.removed ? 'opacity-50' : ''}`}
              >
                <div className="min-w-0">
                  <p className={`text-sm font-semibold ${r.removed ? 'text-slate-400 line-through' : 'text-slate-900'}`}>
                    {r.date.slice(0, 10)} <span className="font-normal text-slate-300">·</span>{' '}
                    <span className={`font-normal ${r.removed ? 'text-slate-400' : 'text-slate-600'}`}>{r.label}</span>
                  </p>
                  <p className="text-xs text-slate-400">
                    {r.channel} — {r.what}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {r.removed ? (
                    <span className="text-xs font-medium text-slate-400">Removed</span>
                  ) : (
                    r.override && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void remove(r);
                        }}
                        className="text-xs font-semibold text-red-600 hover:underline"
                      >
                        Remove
                      </button>
                    )
                  )}
                  <span className="text-slate-300">›</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardBody>

      <div
        className={`overflow-hidden border-t border-slate-100 transition-[grid-template-rows] duration-300 ease-in-out grid ${
          historyOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr] border-t-0'
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="px-5 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Last 30 days</p>
          </div>
          {activity === null ? (
            <p className="px-5 pb-4 text-sm text-slate-400">Loading…</p>
          ) : activity.length === 0 ? (
            <p className="px-5 pb-4 text-sm text-slate-400">No activity in the last 30 days.</p>
          ) : (
            <div className="divide-y divide-slate-50">
              {activity.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm text-slate-700">
                      {a.date ?? '—'} <span className="text-slate-300">·</span>{' '}
                      {a.roomCategoryName ? `${a.roomCategoryName} · ${a.ratePlanName}` : 'Unknown room/rate plan'}
                    </p>
                    <p className="text-xs text-slate-400">
                      {a.otaCode ? OTA_LABEL[a.otaCode] ?? a.otaCode : 'Unknown channel'} — {describeActivity(a)}
                    </p>
                  </div>
                  <p className="shrink-0 text-xs text-slate-400">
                    {new Date(a.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
