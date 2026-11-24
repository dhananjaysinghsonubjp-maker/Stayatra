import { useEffect, useState } from 'react';
import { query, ApiError } from '../../api';
import { useAuth } from '../../AuthContext';
import { Button, PageHeader } from '../../components/ui';
import { SOURCE_LABEL } from '../channel-manager/ota-labels';
import { formatDateShort, formatDateTimeShort } from '../../dateFormat';
import { ReportPrintShell } from './ReportPrintShell';
import { ReportDateRangePill } from './ReportDateRangePill';
import type { IdType } from '../../types';

function todayPlus(days: number) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

function idTypeLabel(t: IdType | null) {
  return t ? t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '—';
}

/** Shared by all three below — a date-range picker sitting above the printable area (`no-print`,
 * so it never ends up on the actual printed page) plus a refresh button. */
function DateRangeBar({ from, to, setFrom, setTo, onRefresh, loading }: { from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void; onRefresh: () => void; loading: boolean }) {
  return (
    <div className="no-print mb-4 flex flex-wrap items-center justify-end gap-2">
      <button onClick={onRefresh} disabled={loading} title="Refresh" className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-brand-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-brand-400 dark:hover:bg-slate-700">
        ⟳
      </button>
      <ReportDateRangePill from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
      <Button onClick={onRefresh} disabled={loading}>
        {loading ? '…' : 'Go'}
      </Button>
    </div>
  );
}

interface PoliceReportRow {
  id: string;
  guestName: string;
  address: string;
  phone: string;
  adults: number;
  children: number;
  roomNumber: string;
  checkIn: string;
  checkOut: string;
  idType: IdType | null;
  idNumber: string | null;
}

export function PoliceReport({ hotelId }: { hotelId: string }) {
  const { token } = useAuth();
  const [from, setFrom] = useState(todayPlus(0));
  const [to, setTo] = useState(todayPlus(0));
  const [rows, setRows] = useState<PoliceReportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      setRows(await query<PoliceReportRow[]>('reports.police', { hotelId, from, to }, token ?? undefined));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load report');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId]);

  return (
    <div>
      <PageHeader title="Police Report" subtitle="Everyone in-house during the selected date range, for local police submission" />
      <DateRangeBar from={from} to={to} setFrom={setFrom} setTo={setTo} onRefresh={run} loading={loading} />
      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {rows && (
        <ReportPrintShell hotelId={hotelId} title="Police Report">
          <h2 className="mb-2 text-lg font-bold text-slate-900">Police Report</h2>
          <p className="mb-3 text-xs text-slate-500">
            From: {formatDateShort(from)} To: {formatDateShort(to)}
          </p>
          <p className="mb-4 rounded-lg bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">Total Guests: {rows.length}</p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-brand-600 text-left text-white">
                  <th className="border border-brand-700 px-2 py-2">#</th>
                  <th className="border border-brand-700 px-2 py-2">Guest Name</th>
                  <th className="border border-brand-700 px-2 py-2">Address</th>
                  <th className="border border-brand-700 px-2 py-2">Phone</th>
                  <th className="border border-brand-700 px-2 py-2">Adults</th>
                  <th className="border border-brand-700 px-2 py-2">Children</th>
                  <th className="border border-brand-700 px-2 py-2">Room No.</th>
                  <th className="border border-brand-700 px-2 py-2">Check-in</th>
                  <th className="border border-brand-700 px-2 py-2">Check-out</th>
                  <th className="border border-brand-700 px-2 py-2">ID Proof Type</th>
                  <th className="border border-brand-700 px-2 py-2">Document ID</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id} className="even:bg-slate-50">
                    <td className="border border-slate-200 px-2 py-1.5">{i + 1}</td>
                    <td className="border border-slate-200 px-2 py-1.5 font-medium">{r.guestName}</td>
                    <td className="border border-slate-200 px-2 py-1.5">{r.address || '—'}</td>
                    <td className="border border-slate-200 px-2 py-1.5">{r.phone || '—'}</td>
                    <td className="border border-slate-200 px-2 py-1.5">{r.adults}</td>
                    <td className="border border-slate-200 px-2 py-1.5">{r.children}</td>
                    <td className="border border-slate-200 px-2 py-1.5">{r.roomNumber}</td>
                    <td className="border border-slate-200 px-2 py-1.5">{formatDateTimeShort(r.checkIn)}</td>
                    <td className="border border-slate-200 px-2 py-1.5">{formatDateTimeShort(r.checkOut)}</td>
                    <td className="border border-slate-200 px-2 py-1.5">{idTypeLabel(r.idType)}</td>
                    <td className="border border-slate-200 px-2 py-1.5">{r.idNumber || '—'}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={11} className="border border-slate-200 px-2 py-6 text-center text-slate-400">
                      No guests in-house during this range
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </ReportPrintShell>
      )}
    </div>
  );
}

interface DayWiseRow {
  date: string;
  bookings: number;
  totalAmount: number;
  averageAmount: number;
}

export function DayWiseBookingReport({ hotelId }: { hotelId: string }) {
  const { token } = useAuth();
  const [from, setFrom] = useState(todayPlus(-6));
  const [to, setTo] = useState(todayPlus(0));
  const [rows, setRows] = useState<DayWiseRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      setRows(await query<DayWiseRow[]>('reports.dayWiseBookings', { hotelId, from, to }, token ?? undefined));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load report');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId]);

  const totalBookings = rows?.reduce((s, r) => s + r.bookings, 0) ?? 0;
  const totalAmount = rows?.reduce((s, r) => s + r.totalAmount, 0) ?? 0;
  const overallAverage = totalBookings > 0 ? totalAmount / totalBookings : 0;

  return (
    <div>
      <PageHeader title="Day Wise Booking Report" subtitle="Bookings and revenue by check-in day" />
      <DateRangeBar from={from} to={to} setFrom={setFrom} setTo={setTo} onRefresh={run} loading={loading} />
      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {rows && (
        <ReportPrintShell hotelId={hotelId} title="Day Wise Booking Report">
          <h2 className="mb-1 text-center text-lg font-bold text-slate-900">Daily Booking Report</h2>
          <p className="mb-4 text-center text-xs text-slate-500">
            Period: {formatDateShort(from)} to {formatDateShort(to)}
          </p>
          <div className="mb-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
            <p>Total Bookings (Rooms): {totalBookings}</p>
            <p>Total Amount: ₹{totalAmount.toFixed(2)}</p>
            <p>Overall Average: ₹{overallAverage.toFixed(2)}</p>
          </div>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-brand-600 text-left text-white">
                <th className="border border-brand-700 px-3 py-2">Date</th>
                <th className="border border-brand-700 px-3 py-2">No Of Bookings (Rooms)</th>
                <th className="border border-brand-700 px-3 py-2">Total Amount</th>
                <th className="border border-brand-700 px-3 py-2">Average Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.date} className="even:bg-slate-50">
                  <td className="border border-slate-200 px-3 py-1.5">{formatDateShort(r.date)}</td>
                  <td className="border border-slate-200 px-3 py-1.5">{r.bookings}</td>
                  <td className="border border-slate-200 px-3 py-1.5">₹{r.totalAmount.toFixed(2)}</td>
                  <td className="border border-slate-200 px-3 py-1.5">₹{r.averageAmount.toFixed(2)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="border border-slate-200 px-3 py-6 text-center text-slate-400">
                    No bookings in this range
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="bg-brand-50 font-bold">
                <td className="border border-slate-200 px-3 py-2">Total</td>
                <td className="border border-slate-200 px-3 py-2">{totalBookings}</td>
                <td className="border border-slate-200 px-3 py-2">₹{totalAmount.toFixed(2)}</td>
                <td className="border border-slate-200 px-3 py-2">₹{overallAverage.toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>
        </ReportPrintShell>
      )}
    </div>
  );
}

interface CheckInCheckOutData {
  occupancy: number;
  checkedIn: number;
  stayOver: number;
  revenue: number;
  totalGst: number;
  totalCommission: number;
  netPayable: number;
  collected: number;
  pending: number;
  details: { id: string; guestName: string; roomNumber: string; source: string; checkIn: string; checkOut: string; gst: number; commission: number; paid: number; total: number; payable: number }[];
  otaRevenue: { source: string; bookings: number; gross: number; commission: number; gst: number; net: number; paid: number; pending: number }[];
}

export function CheckInCheckOutReport({ hotelId }: { hotelId: string }) {
  const { token } = useAuth();
  const [from, setFrom] = useState(todayPlus(0));
  const [to, setTo] = useState(todayPlus(0));
  const [data, setData] = useState<CheckInCheckOutData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      setData(await query<CheckInCheckOutData>('reports.checkInCheckOut', { hotelId, from, to }, token ?? undefined));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load report');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId]);

  return (
    <div>
      <PageHeader title="Check-In and Check-Out Report" subtitle="Occupancy, revenue and channel payable for the selected range" />
      <DateRangeBar from={from} to={to} setFrom={setFrom} setTo={setTo} onRefresh={run} loading={loading} />
      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {data && (
        <ReportPrintShell hotelId={hotelId} title="Check-In and Check-Out Report">
          <h2 className="mb-1 text-lg font-bold text-slate-900">Check-In and Check-Out Report</h2>
          <p className="mb-4 text-xs text-slate-500">
            {formatDateShort(from)} – {formatDateShort(to)}
          </p>

          <table className="mb-5 w-full border-collapse text-sm">
            <tbody>
              <tr className="bg-brand-600 text-white">
                <td className="border border-brand-700 px-3 py-2 font-semibold" colSpan={2}>
                  Occupancy
                </td>
              </tr>
              {[
                ['Occupancy', data.occupancy],
                ['Checked-in', data.checkedIn],
                ['Stay Over', data.stayOver],
                ['Revenue', `₹${data.revenue.toFixed(2)}`],
                ['↳ Total GST', `₹${data.totalGst.toFixed(2)}`],
                ['↳ Total Commission', `₹${data.totalCommission.toFixed(2)}`],
                ['↳ Net Payable', `₹${data.netPayable.toFixed(2)}`],
                ['Collected', `₹${data.collected.toFixed(2)}`],
                ['Pending', `₹${data.pending.toFixed(2)}`],
              ].map(([label, value]) => (
                <tr key={label} className="even:bg-slate-50">
                  <td className="border border-slate-200 px-3 py-1.5 text-slate-600">{label}</td>
                  <td className="border border-slate-200 px-3 py-1.5 text-right font-medium text-slate-900">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="mb-2 text-sm font-bold text-brand-700">Revenue Details</p>
          <div className="mb-5 overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-brand-600 text-left text-white">
                  <th className="border border-brand-700 px-2 py-2">Name</th>
                  <th className="border border-brand-700 px-2 py-2">Room</th>
                  <th className="border border-brand-700 px-2 py-2">Source</th>
                  <th className="border border-brand-700 px-2 py-2">Checkin</th>
                  <th className="border border-brand-700 px-2 py-2">Checkout</th>
                  <th className="border border-brand-700 px-2 py-2">GST</th>
                  <th className="border border-brand-700 px-2 py-2">Comm.</th>
                  <th className="border border-brand-700 px-2 py-2">Paid</th>
                  <th className="border border-brand-700 px-2 py-2">Total</th>
                  <th className="border border-brand-700 px-2 py-2">Payable</th>
                </tr>
              </thead>
              <tbody>
                {data.details.map((d) => (
                  <tr key={d.id} className="even:bg-slate-50">
                    <td className="border border-slate-200 px-2 py-1.5">{d.guestName}</td>
                    <td className="border border-slate-200 px-2 py-1.5">{d.roomNumber}</td>
                    <td className="border border-slate-200 px-2 py-1.5">{SOURCE_LABEL[d.source] ?? d.source}</td>
                    <td className="border border-slate-200 px-2 py-1.5">{formatDateShort(d.checkIn)}</td>
                    <td className="border border-slate-200 px-2 py-1.5">{formatDateShort(d.checkOut)}</td>
                    <td className="border border-slate-200 px-2 py-1.5">₹{d.gst.toFixed(2)}</td>
                    <td className="border border-slate-200 px-2 py-1.5">₹{d.commission.toFixed(2)}</td>
                    <td className="border border-slate-200 px-2 py-1.5">₹{d.paid.toFixed(2)}</td>
                    <td className="border border-slate-200 px-2 py-1.5">₹{d.total.toFixed(2)}</td>
                    <td className="border border-slate-200 px-2 py-1.5">₹{d.payable.toFixed(2)}</td>
                  </tr>
                ))}
                {data.details.length === 0 && (
                  <tr>
                    <td colSpan={10} className="border border-slate-200 px-2 py-6 text-center text-slate-400">
                      No stays in this range
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <p className="mb-2 text-sm font-bold text-brand-700">OTA Revenue Report</p>
          <div className="mb-5 overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-brand-600 text-left text-white">
                  <th className="border border-brand-700 px-2 py-2">OTA Name</th>
                  <th className="border border-brand-700 px-2 py-2">Bookings</th>
                  <th className="border border-brand-700 px-2 py-2">Gross</th>
                  <th className="border border-brand-700 px-2 py-2">Commission</th>
                  <th className="border border-brand-700 px-2 py-2">GST</th>
                  <th className="border border-brand-700 px-2 py-2">Net</th>
                  <th className="border border-brand-700 px-2 py-2">Paid</th>
                  <th className="border border-brand-700 px-2 py-2">Pending</th>
                </tr>
              </thead>
              <tbody>
                {data.otaRevenue.map((o) => (
                  <tr key={o.source} className="even:bg-slate-50">
                    <td className="border border-slate-200 px-2 py-1.5">{SOURCE_LABEL[o.source] ?? o.source}</td>
                    <td className="border border-slate-200 px-2 py-1.5">{o.bookings}</td>
                    <td className="border border-slate-200 px-2 py-1.5">₹{o.gross.toFixed(2)}</td>
                    <td className="border border-slate-200 px-2 py-1.5">₹{o.commission.toFixed(2)}</td>
                    <td className="border border-slate-200 px-2 py-1.5">₹{o.gst.toFixed(2)}</td>
                    <td className="border border-slate-200 px-2 py-1.5">₹{o.net.toFixed(2)}</td>
                    <td className="border border-slate-200 px-2 py-1.5">₹{o.paid.toFixed(2)}</td>
                    <td className="border border-slate-200 px-2 py-1.5">₹{o.pending.toFixed(2)}</td>
                  </tr>
                ))}
                {data.otaRevenue.length === 0 && (
                  <tr>
                    <td colSpan={8} className="border border-slate-200 px-2 py-6 text-center text-slate-400">
                      No OTA bookings in this range
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="rounded-lg bg-brand-50 px-4 py-3 text-right">
            <span className="text-sm font-semibold text-slate-600">NET PAYABLE </span>
            <span className="text-lg font-bold text-brand-700">₹{data.netPayable.toFixed(2)}</span>
          </div>
        </ReportPrintShell>
      )}
    </div>
  );
}
