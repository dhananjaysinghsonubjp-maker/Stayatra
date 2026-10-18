import { useEffect, useState } from 'react';
import { query } from '../../api';
import { useAuth } from '../../AuthContext';
import { Button, Card, CardBody, CardHeader, Field, PageHeader, StatCard, inputClass } from '../../components/ui';
import { BookingsTable } from './BookingsTable';
import { ChannelBadge } from './ChannelBadge';
import { computeCmStats, computeChannelPayout, payableToProperty, type CmStats, type ChannelPayout } from './cmStats';
import { OTA_LABEL } from './ota-labels';
import type { Booking, OtaConnection, RoomCategory } from '../../types';

function todayPlus(days: number) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

/** Same plain CSV-download pattern as the PMS side's Reports.tsx — opens fine in Excel, no
 * charting/spreadsheet library pulled in for something this simple. */
function downloadCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Phase 2's "basic reporting, plus commission vs. hotel net by channel" — built now per explicit request alongside the rest of this restructure. */
export function BusinessReports({ hotelId }: { hotelId: string }) {
  const { token } = useAuth();
  const [connections, setConnections] = useState<OtaConnection[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [categories, setCategories] = useState<RoomCategory[]>([]);
  const [startDate, setStartDate] = useState(todayPlus(-30));
  const [endDate, setEndDate] = useState(todayPlus(30));
  const [channelFilter, setChannelFilter] = useState('all');

  useEffect(() => {
    async function load() {
      const [c, b, cats] = await Promise.all([
        query<OtaConnection[]>('ota.listConnections', { hotelId }, token ?? undefined),
        query<Booking[]>('bookings.listReservations', { hotelId, from: startDate, to: endDate }, token ?? undefined),
        query<RoomCategory[]>('hotels.listRoomCategories', { hotelId }, token ?? undefined),
      ]);
      setConnections(c);
      setBookings(b);
      setCategories(cats);
    }
    void load();
  }, [hotelId, token, startDate, endDate]);

  const filtered = channelFilter === 'all' ? bookings : bookings.filter((b) => b.source === channelFilter);
  const stats = computeCmStats(filtered);

  // § user request — picking one channel here should hide every other channel below, not just
  // in the headline stats. `byChannel` used to always map over every connection regardless of
  // `channelFilter`, so "Sales by channel" and the breakdown table kept showing MMT/Airbnb rows
  // even with only Booking.com selected.
  const channelsToShow = channelFilter === 'all' ? connections : connections.filter((c) => c.otaCode === channelFilter);
  const byChannel = channelsToShow.map((c) => {
    const rows = bookings.filter((b) => b.source === c.otaCode);
    const s = computeCmStats(rows);
    return { connection: c, ...s, ...computeChannelPayout(s, c.commissionRatePercent) };
  });

  // The one row that matches the selected filter exactly — drives the "Gross Sale" /
  // "Amount Payable to Property" summary cards (§ user request) shown only once a specific
  // OTA channel, not "All channels"/Direct/Walk-in, is picked.
  const selectedChannelPayout = channelFilter !== 'all' ? byChannel.find((r) => r.connection.otaCode === channelFilter) : undefined;

  // Hotel-wide version of the same "what actually lands in the bank account" figure, for
  // when no single channel is picked — every OTA's own net payout, plus direct/walk-in
  // revenue in full (no commission or TDS applies there). Mirrors the now-removed Unified
  // Ledger's "Net to you" minus the platform-subscription line, which wasn't useful here.
  const allChannelsGross = byChannel.reduce((sum, r) => sum + r.totalSale, 0);
  const allChannelsPayable = byChannel.reduce((sum, r) => sum + r.netPayout, 0) + (stats.totalSale - allChannelsGross);

  function exportCsv() {
    const rows: (string | number)[][] = [];
    rows.push(['Business Report', `${startDate} to ${endDate}`, channelFilter === 'all' ? 'All channels' : OTA_LABEL[channelFilter] ?? channelFilter]);
    rows.push([]);
    rows.push(['Channel Summary']);
    rows.push(['Channel', 'Bookings', 'Nights', 'Gross Sale', 'Commission', 'TDS', 'Payable to Property']);
    for (const row of byChannel) {
      rows.push([
        OTA_LABEL[row.connection.otaCode] ?? row.connection.otaCode,
        row.totalBookings,
        row.totalNights,
        row.totalSale.toFixed(2),
        row.commissionAmount.toFixed(2),
        (row.ecommerceTds + row.commissionTds).toFixed(2),
        row.netPayout.toFixed(2),
      ]);
    }
    if (channelFilter === 'all') {
      rows.push(['Direct + Walk-in', '', '', (stats.totalSale - allChannelsGross).toFixed(2), '0.00', '0.00', (stats.totalSale - allChannelsGross).toFixed(2)]);
      rows.push(['Total', '', '', allChannelsGross.toFixed(2), '', '', allChannelsPayable.toFixed(2)]);
    }
    rows.push([]);
    rows.push(['Bookings']);
    rows.push(['Booking ID', 'Customer', 'Check-in', 'Check-out', 'Channel', 'Total Amount', 'Payable to Property', 'Status']);
    for (const b of filtered) {
      const payable = payableToProperty(b, connections);
      rows.push([
        b.id,
        b.guestName,
        b.checkIn.slice(0, 10),
        b.checkOut.slice(0, 10),
        OTA_LABEL[b.source] ?? b.source,
        Number(b.totalAmount).toFixed(2),
        payable != null ? payable.toFixed(2) : '—',
        b.status,
      ]);
    }
    const label = channelFilter === 'all' ? 'all-channels' : channelFilter;
    downloadCsv(`business-report-${label}-${startDate}-to-${endDate}.csv`, rows);
  }

  return (
    <div>
      <PageHeader
        title="Business Reports"
        subtitle="Sales, nights, and cancellations by date range and channel."
        action={
          <Button type="button" variant="secondary" onClick={exportCsv}>
            Export to Excel
          </Button>
        }
      />

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

      {selectedChannelPayout && (
        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard
            label={`Gross Sale (${OTA_LABEL[selectedChannelPayout.connection.otaCode] ?? selectedChannelPayout.connection.otaCode})`}
            value={`₹${selectedChannelPayout.totalSale.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`}
            hint="Guest-paid amount, taxes included"
            tone="brand"
          />
          <StatCard
            label="Commission"
            value={`−₹${selectedChannelPayout.commissionAmount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`}
            hint={selectedChannelPayout.connection.commissionRatePercent ? `${selectedChannelPayout.connection.commissionRatePercent}% of gross` : 'No commission rate set'}
            tone="amber"
          />
          <StatCard
            label="TDS withheld"
            value={`−₹${(selectedChannelPayout.ecommerceTds + selectedChannelPayout.commissionTds).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`}
            hint="0.1% e-comm + 2% on commission"
            tone="amber"
          />
          <StatCard
            label="Amount Payable to Property"
            value={`₹${selectedChannelPayout.netPayout.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`}
            hint="What actually lands in your bank account"
            tone="brand"
          />
        </div>
      )}

      {channelFilter === 'all' && byChannel.length > 0 && (
        <div className="mb-6">
          <StatCard
            label="Amount Payable to Property — All Channels"
            value={`₹${allChannelsPayable.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`}
            hint="Every OTA's net payout + direct/walk-in revenue (no commission there) — what actually lands in your bank account across everything"
            tone="brand"
          />
        </div>
      )}

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
                  <th className="px-5 py-3">Commission</th>
                  <th className="px-5 py-3">TDS</th>
                  <th className="px-5 py-3">Payable to property</th>
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
                    <td className="px-5 py-3 text-amber-600">
                      {row.connection.commissionRatePercent ? `−₹${row.commissionAmount.toLocaleString('en-IN', { maximumFractionDigits: 2 })} (${row.connection.commissionRatePercent}%)` : '—'}
                    </td>
                    <td className="px-5 py-3 text-amber-600">−₹{(row.ecommerceTds + row.commissionTds).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                    <td className="px-5 py-3 font-medium text-slate-900">₹{row.netPayout.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <BookingsTable bookings={filtered} categories={categories} />
    </div>
  );
}

/** A plain horizontal bar per channel, sorted by sale — no charting library pulled in for something
 * this simple; width is just a CSS percentage of the top channel's sale. */
function SalesByChannelChart({ rows }: { rows: (CmStats & ChannelPayout & { connection: OtaConnection })[] }) {
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
