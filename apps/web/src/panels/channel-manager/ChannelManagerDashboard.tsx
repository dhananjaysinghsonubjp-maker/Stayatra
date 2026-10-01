import { useEffect, useState } from 'react';
import { query } from '../../api';
import { useAuth } from '../../AuthContext';
import { StatCard } from '../../components/ui';
import { BookingsTable } from './BookingsTable';
import { computeCmStats } from './cmStats';
import type { Booking, OtaConnection } from '../../types';
import type { Tab } from '../../layout/Sidebar';

/** The Channel Manager's own dashboard block — headline stats and recent bookings, nothing
 * else. Channel setup/connect lives entirely on the Connected Channels setup page (reached from
 * the sidebar) — deliberately no shortcut or status summary duplicated here. Rendered inside
 * Dashboard.tsx when the org has Channel Manager enabled. */
export function ChannelManagerDashboard({ hotelId, onNavigate }: { hotelId: string; onNavigate?: (tab: Tab) => void }) {
  const { token } = useAuth();
  const [connections, setConnections] = useState<OtaConnection[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);

  async function load() {
    const [c, b] = await Promise.all([
      query<OtaConnection[]>('ota.listConnections', { hotelId }, token ?? undefined),
      query<Booking[]>('bookings.listReservations', { hotelId }, token ?? undefined),
    ]);
    setConnections(c);
    setBookings(b);
  }
  useEffect(() => {
    void load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId, token]);

  const stats = computeCmStats(bookings);
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

      <div className="mb-2 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Recent bookings</h3>
          <p className="text-xs text-slate-500">Most recent 10, across every connected channel.</p>
        </div>
        <button onClick={() => onNavigate?.('bookings')} className="text-xs font-medium text-brand-600 hover:underline">
          View all →
        </button>
      </div>
      <BookingsTable bookings={recent} connections={connections} />
    </div>
  );
}
