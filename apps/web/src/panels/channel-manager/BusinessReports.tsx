import { useEffect, useState } from 'react';
import { query } from '../../api';
import { useAuth } from '../../AuthContext';
import { Card, CardBody, CardHeader, Field, PageHeader, StatCard, inputClass } from '../../components/ui';
import { BookingsTable } from './BookingsTable';
import { ChannelBadge } from './ChannelBadge';
import { computeCmStats, type CmStats } from './cmStats';
import { OTA_LABEL } from './ota-labels';
import type { Booking, OtaConnection } from '../../types';

function todayPlus(days: number) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

/** Phase 2's "basic reporting, plus commission vs. hotel net by channel" — built now per explicit request alongside the rest of this restructure. */
export function BusinessReports({ hotelId }: { hotelId: string }) {
  const { token } = useAuth();
  const [connections, setConnections] = useState<OtaConnection[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [startDate, setStartDate] = useState(todayPlus(-30));
  const [endDate, setEndDate] = useState(todayPlus(30));
  const [channelFilter, setChannelFilter] = useState('all');

  useEffect(() => {
    async function load() {
      const [c, b] = await Promise.all([
        query<OtaConnection[]>('ota.listConnections', { hotelId }, token ?? undefined),
        query<Booking[]>('bookings.listReservations', { hotelId, from: startDate, to: endDate }, token ?? undefined),
      ]);
      setConnections(c);
      setBookings(b);
    }
    void load();
  }, [hotelId, token, startDate, endDate]);

  const filtered = channelFilter === 'all' ? bookings : bookings.filter((b) => b.source === channelFilter);
  const stats = computeCmStats(filtered);

  const byChannel = connections.map((c) => {
    const rows = bookings.filter((b) => b.source === c.otaCode);
    const s = computeCmStats(rows);
    const commission = c.commissionRatePercent ? Number(c.commissionRatePercent) : null;
    const net = commission != null ? s.totalSale * (1 - commission / 100) : null;
    return { connection: c, ...s, net };
  });

  return (
    <div>
      <PageHeader title="Business Reports" subtitle="Sales, nights, and cancellations by date range and channel." />

      <Card className="mb-6">
        <CardBody>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="From">
              <input className={inputClass} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
            <Field label="To">
              <input className={inputClass} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </Field>
            <Field label="Channel">
              <select className={inputClass} value={channelFilter} onChange={(e) => setChannelFilter(e.target.value)}>
                <option value="all">All channels</option>
                <option value="direct">Direct</option>
                <option value="walk_in">Walk-in</option>
                {connections.map((c) => (
                  <option key={c.id} value={c.otaCode}>
                    {OTA_LABEL[c.otaCode] ?? c.otaCode}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </CardBody>
      </Card>

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Total Sale" value={`₹${stats.totalSale.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`} tone="brand" />
        <StatCard label="Total Nights" value={stats.totalNights} />
        <StatCard label="Bookings" value={stats.totalBookings} />
        <StatCard label="ARR" value={`₹${stats.arr.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`} tone="brand" />
      </div>

      {byChannel.some((row) => row.totalSale > 0) && (
        <Card className="mb-6">
          <CardHeader title="Sales by channel" subtitle="Which platform this range's revenue actually came from." />
          <CardBody>
            <SalesByChannelChart rows={byChannel} />
          </CardBody>
        </Card>
      )}

      {byChannel.length > 0 && (
        <Card className="mb-6">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-medium text-slate-500">
                  <th className="px-5 py-3">Channel</th>
                  <th className="px-5 py-3">Bookings</th>
                  <th className="px-5 py-3">Nights</th>
                  <th className="px-5 py-3">Gross sale</th>
                  <th className="px-5 py-3">Commission %</th>
                  <th className="px-5 py-3">Net to property</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {byChannel.map((row) => (
                  <tr key={row.connection.id}>
                    <td className="px-5 py-3 font-medium text-slate-900">
                      <ChannelBadge source={row.connection.otaCode} />
                    </td>
                    <td className="px-5 py-3 text-slate-600">{row.totalBookings}</td>
                    <td className="px-5 py-3 text-slate-600">{row.totalNights}</td>
                    <td className="px-5 py-3 text-slate-900">₹{row.totalSale.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                    <td className="px-5 py-3 text-slate-600">{row.connection.commissionRatePercent ? `${row.connection.commissionRatePercent}%` : '—'}</td>
                    <td className="px-5 py-3 text-slate-900">{row.net != null ? `₹${row.net.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <BookingsTable bookings={filtered} connections={connections} />
    </div>
  );
}

/** A plain horizontal bar per channel, sorted by sale — no charting library pulled in for something
 * this simple; width is just a CSS percentage of the top channel's sale. */
function SalesByChannelChart({ rows }: { rows: (CmStats & { connection: OtaConnection; net: number | null })[] }) {
  const sorted = [...rows].filter((r) => r.totalSale > 0).sort((a, b) => b.totalSale - a.totalSale);
  const max = Math.max(...sorted.map((r) => r.totalSale), 1);

  return (
    <div className="space-y-3">
      {sorted.map((row) => (
        <div key={row.connection.id} className="flex items-center gap-3">
          <div className="w-40 shrink-0 text-sm text-slate-700">
            <ChannelBadge source={row.connection.otaCode} />
          </div>
          <div className="h-6 flex-1 rounded-md bg-slate-100">
            <div className="h-6 rounded-md bg-brand-600" style={{ width: `${(row.totalSale / max) * 100}%` }} />
          </div>
          <div className="w-28 shrink-0 text-right text-sm font-medium text-slate-900">
            ₹{row.totalSale.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
          </div>
        </div>
      ))}
    </div>
  );
}
