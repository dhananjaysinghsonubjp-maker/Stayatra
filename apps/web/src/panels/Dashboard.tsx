import { useEffect, useState } from 'react';
import { query } from '../api';
import { useAuth } from '../AuthContext';
import { Badge, Card, CardBody, CardHeader, EmptyState, StatCard } from '../components/ui';
import { ChannelManagerDashboard } from './channel-manager/ChannelManagerDashboard';
import { OccupancyDonut, RevenueHeatmap, RevenueTrendChart } from './dashboard/PerformanceCharts';
import type { Booking, CleaningRecord, InHouseRow, OtaConnection, Room, StaffProfile } from '../types';
import type { Tab } from '../layout/Sidebar';

function isToday(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  return d.toDateString() === now.toDateString();
}

/**
 * India-first (§ user request) — the greeting must follow IST specifically, not whatever
 * timezone the browser/device happens to be set to. Computed via a fixed UTC+5:30 offset
 * rather than Intl's locale-dependent formatting, so it's exact regardless of device locale.
 */
function getIstHour() {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utcMs + 5.5 * 60 * 60000).getHours();
}

function greeting(): { text: string; emoji: string } {
  const h = getIstHour();
  if (h < 5) return { text: 'Good Night', emoji: '🌙' };
  if (h < 12) return { text: 'Good Morning', emoji: '☀️' };
  if (h < 17) return { text: 'Good Afternoon', emoji: '🌤️' };
  if (h < 21) return { text: 'Good Evening', emoji: '🌆' };
  return { text: 'Good Night', emoji: '🌙' };
}

/** The greeting banner's own right-side numbers (§ user request — simple/sleek, not the blue-gradient reference screenshot). */
function HeaderStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl bg-slate-50 px-4 py-2.5 text-center dark:bg-slate-700/50">
      <p className="text-[11px] font-medium text-slate-400 dark:text-slate-400">{label}</p>
      <p className="mt-0.5 text-lg font-semibold text-slate-900 dark:text-white">{value}</p>
    </div>
  );
}

/**
 * The greeting banner itself (§ user request) — shared by both the PMS and the
 * Channel-Manager-only dashboard, since most of this platform's real hotels today are
 * CM-only (no physical-room tracking), and the banner had been built only into the PMS
 * branch at first — invisible on every account except the one with PMS enabled.
 */
function GreetingBanner({ hotelName, stats }: { hotelName: string; stats: { label: string; value: string | number }[] }) {
  const { text: greetingText, emoji: greetingEmoji } = greeting();
  return (
    <div className="mb-6 rounded-2xl border border-slate-200 bg-white px-6 py-5 dark:border-slate-700 dark:bg-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            {greetingText} <span aria-hidden>{greetingEmoji}</span>
          </h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{hotelName}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          {stats.map((s) => (
            <HeaderStat key={s.label} label={s.label} value={s.value} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** §Skymax reference (OccupancyCounters.tsx) — one white card, 4 big coloured counters, exact
 * same 4 states and colours (In House navy/brand, Available green, Housekeeping amber, Delayed red). */
function OccupancyCounters({ occupied, available, housekeeping, delayed }: { occupied: number; available: number; housekeeping: number; delayed: number }) {
  const counters: { label: string; value: number; tone: string }[] = [
    { label: 'In House', value: occupied, tone: 'text-brand-600 dark:text-brand-400' },
    { label: 'Available', value: available, tone: 'text-emerald-700 dark:text-emerald-400' },
    { label: 'Housekeeping', value: housekeeping, tone: 'text-amber-700 dark:text-amber-400' },
    { label: 'Delayed', value: delayed, tone: 'text-red-700 dark:text-red-400' },
  ];
  return (
    <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
      <div className="grid grid-cols-4 gap-2">
        {counters.map((c) => (
          <div key={c.label} className="text-center">
            <p className={`text-2xl font-bold ${c.tone}`}>{c.value}</p>
            <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{c.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/** §Skymax reference (dashboard.tsx's red alert) — a compact, tappable summary banner; the
 * full per-item list with Resolve actions lives on the Housekeeping tab, not duplicated here. */
function DiscrepancyAlert({ count, noGuestCount, onPress }: { count: number; noGuestCount: number; onPress: () => void }) {
  if (count === 0) return null;
  return (
    <button
      onClick={onPress}
      className="mb-6 flex w-full items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-3.5 text-left hover:bg-red-100 dark:border-red-900/50 dark:bg-red-900/20 dark:hover:bg-red-900/30"
    >
      <span className="text-xl">⚠️</span>
      <div className="flex-1">
        <p className="text-sm font-bold text-red-800 dark:text-red-300">
          {count} discrepanc{count === 1 ? 'y needs' : 'ies need'} review
        </p>
        {noGuestCount > 0 && (
          <p className="mt-0.5 text-xs text-red-700 dark:text-red-400">
            {noGuestCount} cleaning{noGuestCount === 1 ? '' : 's'} with no matching guest check-in
          </p>
        )}
      </div>
      <span className="text-red-400">›</span>
    </button>
  );
}

/** §user request — "dashboard pe highlight create nahi hua": a GM/FMO-submitted staff profile
 * needs a visible owner-side nudge, same pattern as the discrepancy alert above but amber (an
 * admin task, not a red "something's wrong" signal). */
function StaffApprovalAlert({ count, onPress }: { count: number; onPress: () => void }) {
  if (count === 0) return null;
  return (
    <button
      onClick={onPress}
      className="mb-6 flex w-full items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-left hover:bg-amber-100 dark:border-amber-900/50 dark:bg-amber-900/20 dark:hover:bg-amber-900/30"
    >
      <span className="text-xl">👤</span>
      <div className="flex-1">
        <p className="text-sm font-bold text-amber-800 dark:text-amber-300">
          {count} staff profile{count === 1 ? '' : 's'} awaiting your approval
        </p>
        <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">Submitted by the GM/front desk — review and approve or reject.</p>
      </div>
      <span className="text-amber-400">›</span>
    </button>
  );
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function inRange(iso: string, from: Date, to: Date) {
  const d = new Date(iso);
  return d >= from && d < to;
}

function formatUpdatedAt(ts: number) {
  const seconds = Math.round((Date.now() - ts) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  return `${minutes} min${minutes === 1 ? '' : 's'} ago`;
}

function PerfCard({ label, value, compareLabel, compareValue }: { label: string; value: string | number; compareLabel: string; compareValue: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-900 dark:text-white">{label}</p>
        <span className="text-slate-300 dark:text-slate-600">›</span>
      </div>
      <p className="mt-3 text-3xl font-bold text-slate-900 dark:text-white">{value}</p>
      <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
        {compareLabel} <span className="font-semibold text-slate-600 dark:text-slate-300">{compareValue}</span>
      </p>
    </div>
  );
}

/**
 * "Performance Overview" (§ user request, matching a reference OTA-extranet widget) — Room
 * Nights/Revenue/Check-ins, Today-so-far vs Month view, each compared against last month. The
 * reference screenshot's 4th card ("Property Visits") needs website-traffic analytics this
 * platform has no source for (we don't host the OTA listing pages ourselves) — dropped rather
 * than shown with a fabricated number, per explicit confirmation.
 */
function PerformanceOverview({ bookings, lastUpdatedAt }: { bookings: Booking[]; lastUpdatedAt: number }) {
  const [view, setView] = useState<'today' | 'month'>('today');

  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = new Date(todayStart.getTime() + 86400000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const daysInLastMonth = new Date(now.getFullYear(), now.getMonth(), 0).getDate();

  const active = bookings.filter((b) => b.status !== 'cancelled');
  const bySource = (field: 'createdAt' | 'checkIn', from: Date, to: Date) => active.filter((b) => inRange(b[field], from, to));

  const sumNights = (list: Booking[]) => list.reduce((s, b) => s + b.nights, 0);
  const sumRevenue = (list: Booking[]) => list.reduce((s, b) => s + Number(b.totalAmount), 0);

  const lastMonthBooked = bySource('createdAt', lastMonthStart, monthStart);
  const lastMonthArrivals = bySource('checkIn', lastMonthStart, monthStart);
  const lastMonthNightsAvg = sumNights(lastMonthBooked) / daysInLastMonth;
  const lastMonthRevenueAvg = sumRevenue(lastMonthBooked) / daysInLastMonth;
  const lastMonthCheckinsAvg = lastMonthArrivals.length / daysInLastMonth;

  const todayBooked = bySource('createdAt', todayStart, todayEnd);
  const todayArrivals = bySource('checkIn', todayStart, todayEnd);
  const monthBooked = bySource('createdAt', monthStart, nextMonthStart);
  const monthArrivals = bySource('checkIn', monthStart, nextMonthStart);

  const current =
    view === 'today'
      ? {
          nights: sumNights(todayBooked),
          revenue: sumRevenue(todayBooked),
          checkins: todayArrivals.length,
          nightsCompareLabel: 'vs last month daily average:',
          nightsCompareValue: `${lastMonthNightsAvg.toFixed(1)} Room nights`,
          revenueCompareLabel: 'vs last month daily average:',
          revenueCompareValue: `₹${lastMonthRevenueAvg.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,
          checkinsCompareLabel: 'vs last month daily average:',
          checkinsCompareValue: `${lastMonthCheckinsAvg.toFixed(1)} check-in${lastMonthCheckinsAvg === 1 ? '' : 's'}`,
        }
      : {
          nights: sumNights(monthBooked),
          revenue: sumRevenue(monthBooked),
          checkins: monthArrivals.length,
          nightsCompareLabel: 'vs last month:',
          nightsCompareValue: `${sumNights(lastMonthBooked)} Room nights`,
          revenueCompareLabel: 'vs last month:',
          revenueCompareValue: `₹${sumRevenue(lastMonthBooked).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,
          checkinsCompareLabel: 'vs last month:',
          checkinsCompareValue: `${lastMonthArrivals.length} check-in${lastMonthArrivals.length === 1 ? '' : 's'}`,
        };

  return (
    <div className="mb-6">
      <div className="mb-6 flex items-center gap-4">
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-200 to-slate-200 dark:via-slate-700 dark:to-slate-700" />
        <div className="text-center">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">Performance Overview</h2>
          <p className="text-xs text-slate-400 dark:text-slate-500">Last updated {formatUpdatedAt(lastUpdatedAt)}</p>
        </div>
        <div className="h-px flex-1 bg-gradient-to-l from-transparent via-slate-200 to-slate-200 dark:via-slate-700 dark:to-slate-700" />
      </div>

      <div className="mb-5 inline-flex rounded-full bg-slate-100 p-1 dark:bg-slate-800">
        <button
          type="button"
          onClick={() => setView('today')}
          className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${view === 'today' ? 'bg-brand-600 text-white' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'}`}
        >
          Today so far
        </button>
        <button
          type="button"
          onClick={() => setView('month')}
          className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${view === 'month' ? 'bg-brand-600 text-white' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'}`}
        >
          Switch to Month view
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <PerfCard label="Room Nights" value={current.nights} compareLabel={current.nightsCompareLabel} compareValue={current.nightsCompareValue} />
        <PerfCard label="Revenue" value={`₹${current.revenue.toLocaleString('en-IN')}`} compareLabel={current.revenueCompareLabel} compareValue={current.revenueCompareValue} />
        <PerfCard label="Check-ins" value={current.checkins} compareLabel={current.checkinsCompareLabel} compareValue={current.checkinsCompareValue} />
      </div>
    </div>
  );
}

export function Dashboard({
  hotelId,
  hotelName,
  onNavigate,
  hasPms = true,
  hasChannelManager = false,
  isOwner = false,
}: {
  hotelId: string;
  /** Shown in the greeting banner (§ user request) in place of the sidebar's own hotel-name display. */
  hotelName: string;
  onNavigate: (tab: Tab) => void;
  /** This whole dashboard (occupancy/arrivals/departures/collected) is PMS-shaped content — a Channel-Manager-only org has nothing here to show. */
  hasPms?: boolean;
  hasChannelManager?: boolean;
  /** Pending-staff-approval banner (§ user request) is an owner-only concern — a GM/front_desk
   * already knows they submitted it, so it's not shown to them. */
  isOwner?: boolean;
}) {
  const { token } = useAuth();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [pendingStaffCount, setPendingStaffCount] = useState(0);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [cleanings, setCleanings] = useState<CleaningRecord[]>([]);
  const [inHouseRows, setInHouseRows] = useState<InHouseRow[]>([]);
  const [cmConnections, setCmConnections] = useState<OtaConnection[]>([]);
  const [cmBookings, setCmBookings] = useState<Booking[]>([]);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(Date.now());

  useEffect(() => {
    if (!hasPms) return;
    async function load() {
      const [r, b, c, ih] = await Promise.all([
        query<Room[]>('bookings.getRoomBoard', { hotelId }, token ?? undefined),
        query<Booking[]>('bookings.listReservations', { hotelId }, token ?? undefined),
        query<CleaningRecord[]>('cleaning.list', { hotelId, flaggedOnly: true }, token ?? undefined),
        query<InHouseRow[]>('bookings.listInHouse', { hotelId }, token ?? undefined),
      ]);
      setRooms(r);
      setBookings(b);
      setCleanings(c);
      setInHouseRows(ih);
      setLastUpdatedAt(Date.now());
    }
    void load();
    const id = setInterval(load, 8000);
    return () => clearInterval(id);
  }, [hotelId, token, hasPms]);

  useEffect(() => {
    if (!isOwner) return;
    async function load() {
      const list = await query<StaffProfile[]>('staff.listAll', { hotelId }, token ?? undefined);
      setPendingStaffCount(list.filter((s) => s.approvalStatus === 'pending').length);
    }
    void load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [hotelId, token, isOwner]);

  // The banner's own stats for a Channel-Manager-only account (§ user request) — most of this
  // platform's real hotels today have no PMS/physical rooms at all, just OTA bookings.
  useEffect(() => {
    if (hasPms || !hasChannelManager) return;
    async function load() {
      const [c, b] = await Promise.all([
        query<OtaConnection[]>('ota.listConnections', { hotelId }, token ?? undefined),
        query<Booking[]>('bookings.listReservations', { hotelId }, token ?? undefined),
      ]);
      setCmConnections(c);
      setCmBookings(b);
      setLastUpdatedAt(Date.now());
    }
    void load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [hotelId, token, hasPms, hasChannelManager]);

  if (!hasPms) {
    const todaysBookings = cmBookings.filter((b) => isToday(b.createdAt) && b.status !== 'cancelled').length;
    const activeChannels = cmConnections.filter((c) => c.status === 'connected').length;
    return (
      <div>
        {hasChannelManager ? (
          <>
            <GreetingBanner
              hotelName={hotelName}
              stats={[
                { label: "Today's Bookings", value: todaysBookings },
                { label: 'Active Channels', value: activeChannels },
                { label: 'Total Bookings', value: cmBookings.filter((b) => b.status !== 'cancelled').length },
              ]}
            />
            <PerformanceOverview bookings={cmBookings} lastUpdatedAt={lastUpdatedAt} />
            <div className="mb-8 grid grid-cols-1 gap-5 lg:grid-cols-2">
              <RevenueTrendChart bookings={cmBookings} />
              <RevenueHeatmap bookings={cmBookings} />
            </div>
            <ChannelManagerDashboard hotelId={hotelId} onNavigate={onNavigate} />
          </>
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
  const available = rooms.filter((r) => r.status === 'available').length;
  const housekeepingRooms = rooms.filter((r) => r.status === 'housekeeping').length;
  const total = rooms.length;
  const arrivals = bookings.filter((b) => isToday(b.checkIn) && b.status !== 'cancelled');
  const departures = bookings.filter((b) => isToday(b.checkOut) && b.status === 'checked_in');
  const collectedToday = bookings
    .flatMap((b) => b.payments ?? [])
    .filter((p) => isToday(p.collectedAt))
    .reduce((sum, p) => sum + Number(p.amount), 0);
  const unflaggedCleanings = cleanings.filter((c) => !c.resolvedAt);
  const delayedCount = inHouseRows.filter((r) => r.delayed).length;
  const discrepancyCount = unflaggedCleanings.length + delayedCount;

  // §user request — "owner dashboard same to same yahan paste kar do, jo currently bana rakha
  // hai wo FMO/GM ko shift kar do": owner gets Skymax's own Owner Dashboard shape exactly
  // (title + total rooms + discrepancy alert + occupancy counters, nothing chart/revenue-shaped);
  // the richer revenue dashboard that used to be shared moves to be GM/front_desk-only.
  if (isOwner) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Owner's Dashboard</h1>
        <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">
          {hotelName} · TOTAL ROOMS: {total}
        </p>

        <StaffApprovalAlert count={pendingStaffCount} onPress={() => onNavigate('housekeeping')} />
        <DiscrepancyAlert count={discrepancyCount} noGuestCount={unflaggedCleanings.length} onPress={() => onNavigate('housekeeping')} />
        <OccupancyCounters occupied={occupied} available={available} housekeeping={housekeepingRooms} delayed={delayedCount} />
      </div>
    );
  }

  return (
    <div>
      <GreetingBanner
        hotelName={hotelName}
        stats={[
          { label: 'Revenue Today', value: `₹${collectedToday.toLocaleString('en-IN')}` },
          { label: 'Occupancy', value: total ? `${Math.round((occupied / total) * 100)}%` : '—' },
          { label: 'Occupied Rooms', value: occupied },
        ]}
      />

      {/* §user request — discrepancies are an owner-only concern; FMO/GM gets the occupancy
          counts but not the discrepancy alert itself (that's the Owner Dashboard branch above). */}
      <OccupancyCounters occupied={occupied} available={available} housekeeping={housekeepingRooms} delayed={delayedCount} />

      <PerformanceOverview bookings={bookings} lastUpdatedAt={lastUpdatedAt} />

      <div className="mb-8 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <OccupancyDonut total={total} occupied={occupied} />
        <div className="lg:col-span-2">
          <RevenueTrendChart bookings={bookings} />
        </div>
      </div>
      <div className="mb-8">
        <RevenueHeatmap bookings={bookings} />
      </div>

      {hasChannelManager && <ChannelManagerDashboard hotelId={hotelId} onNavigate={onNavigate} />}

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Occupancy" value={total ? `${occupied}/${total}` : '—'} hint={total ? `${Math.round((occupied / total) * 100)}% occupied` : 'No rooms yet'} tone="brand" />
        <StatCard label="Arrivals today" value={arrivals.length} hint="confirmed & walk-in" />
        <StatCard label="Departures today" value={departures.length} hint="awaiting checkout cleaning" />
        <StatCard label="Collected today" value={`₹${collectedToday.toLocaleString('en-IN')}`} tone="brand" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Room status"
            action={
              <button onClick={() => onNavigate('rooms')} className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">
                Open Room View →
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
                        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400'
                        : r.status === 'occupied'
                          ? 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300'
                          : 'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400'
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
              <button onClick={() => onNavigate('rooms')} className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">
                Check in →
              </button>
            }
          />
          <CardBody>
            {arrivals.length === 0 ? (
              <EmptyState title="No arrivals today" />
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-700">
                {arrivals.map((b) => (
                  <li key={b.id} className="flex items-center justify-between py-2 text-sm">
                    <span className="text-slate-700 dark:text-slate-300">{b.guestName}</span>
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
