import { useEffect, useState } from 'react';
import { query } from '../../api';
import { useAuth } from '../../AuthContext';
import { StatCard } from '../../components/ui';
import { BookingsTable } from './BookingsTable';
import { computeCmStats } from './cmStats';
import type { Booking, RoomCategory } from '../../types';
import type { Tab } from '../../layout/Sidebar';

/** The Channel Manager's own dashboard block — headline stats and recent bookings, nothing
 * else. Channel setup/connect lives entirely on the Connected Channels setup page (reached from
 * the sidebar) — deliberately no shortcut or status summary duplicated here. Rendered inside
 * Dashboard.tsx when the org has Channel Manager enabled. */
export function ChannelManagerDashboard({ hotelId, onNavigate }: { hotelId: string; onNavigate?: (tab: Tab) => void }) {
  const { token } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [categories, setCategories] = useState<RoomCategory[]>([]);

  async function load() {
    const [b, cats] = await Promise.all([
      query<Booking[]>('bookings.listReservations', { hotelId }, token ?? undefined),
      query<RoomCategory[]>('hotels.listRoomCategories', { hotelId }, token ?? undefined),
    ]);
    setBookings(b);
    setCategories(cats);
  }
  useEffect(() => {
    void load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId, token]);

  const stats = computeCmStats(bookings);
  const today = new Date().toISOString().slice(0, 10);
  // Not-yet-arrived reservations, soonest first — separate from "Recent bookings" below (which
  // is sorted by most-recently-dated and mixes past/future) so an owner can see at a glance what's
  // still coming, not what already happened (§ user request).
  const upcoming = [...bookings]
    .filter((b) => b.status !== 'cancelled' && b.checkIn.slice(0, 10) >= today)
    .sort((a, b) => a.checkIn.localeCompare(b.checkIn));
  const recent = [...bookings].sort((a, b) => b.checkIn.localeCompare(a.checkIn)).slice(0, 10);

  return (
    <div className="mb-8">
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Total Sale" value={`₹${stats.totalSale.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`} tone="brand" />
        <StatCard label="Total Nights" value={stats.totalNights} />
        <StatCard label="Total No of Bookings" value={stats.totalBookings} />
        <StatCard label="Total Cancelled Bookings" value={stats.cancelledBookings} tone={stats.cancelledBookings > 0 ? 'amber' : 'slate'} />
        <StatCard label="ARR (Average Room Rent)" value={`₹${stats.arr.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`} tone="brand" />
      </div>

      <div className="mb-8">
        <div className="mb-2 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Upcoming bookings</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">Not yet arrived — soonest check-in first.</p>
          </div>
          <span className="text-xs font-medium text-slate-400 dark:text-slate-500">{upcoming.length} upcoming</span>
        </div>
        <BookingsTable bookings={upcoming} categories={categories} />
      </div>

      <div className="mb-2 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Recent bookings</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">Most recent 10, across every connected channel.</p>
        </div>
        <button onClick={() => onNavigate?.('bookings')} className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">
          View all →
        </button>
      </div>
      <BookingsTable bookings={recent} categories={categories} />
    </div>
  );
}
