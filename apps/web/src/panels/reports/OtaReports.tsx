import { useEffect, useState } from 'react';
import { query, ApiError } from '../../api';
import { useAuth } from '../../AuthContext';
import { Card, CardBody, EmptyState, PageHeader, inputClass } from '../../components/ui';
import { SOURCE_LABEL } from '../channel-manager/ota-labels';
import { formatDateShort } from '../../dateFormat';
import { ReportPrintShell } from './ReportPrintShell';
import { DateRangeBar, todayPlus } from './DocumentReports';
import { ReportDateRangePill } from './ReportDateRangePill';

interface OtaBookingRow {
  source: string;
  totalAmount: number;
  totalCommission: number;
  totalGst: number;
  amountToHotel: number;
}

export function OtaBookingReport({ hotelId }: { hotelId: string }) {
  const { token } = useAuth();
  const [from, setFrom] = useState(todayPlus(0));
  const [to, setTo] = useState(todayPlus(0));
  const [data, setData] = useState<{ previousRevenueMtd: number; todaysRevenue: number; monthToDateRevenue: number; rows: OtaBookingRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      setData(await query('reports.otaBooking', { hotelId, from, to }, token ?? undefined));
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
      <PageHeader title="OTA Booking Report" subtitle="Per-channel revenue, commission and GST for the selected range" />
      <DateRangeBar from={from} to={to} setFrom={setFrom} setTo={setTo} onRefresh={run} loading={loading} />
      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {data && (
        <ReportPrintShell hotelId={hotelId} title="OTA Booking Report">
          <div className="mb-4 flex items-start justify-between">
            <h2 className="text-lg font-bold text-slate-900">OTA Booking Report</h2>
            <p className="text-xs text-slate-500">
              {formatDateShort(from)} to {formatDateShort(to)}
            </p>
          </div>

          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-3 text-sm">
            <span>
              <span className="font-semibold text-slate-600">Previous Revenue (MTD):</span> ₹{data.previousRevenueMtd.toLocaleString('en-IN')}
            </span>
            <span>
              <span className="font-semibold text-slate-600">Today's Revenue:</span> ₹{data.todaysRevenue.toLocaleString('en-IN')}
            </span>
          </div>

          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-slate-800 text-left text-white">
                {['OTA', 'Total Amount', 'Total Commission', 'Total GST', 'Amount To Hotel'].map((h) => (
                  <th key={h} className="border border-slate-700 px-3 py-2 text-xs uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.source} className="even:bg-slate-50">
                  <td className="border border-slate-200 px-3 py-1.5 font-medium">{SOURCE_LABEL[r.source] ?? r.source}</td>
                  <td className="border border-slate-200 px-3 py-1.5">₹{r.totalAmount.toFixed(2)}</td>
                  <td className="border border-slate-200 px-3 py-1.5">₹{r.totalCommission.toFixed(2)}</td>
                  <td className="border border-slate-200 px-3 py-1.5">₹{r.totalGst.toFixed(2)}</td>
                  <td className="border border-slate-200 px-3 py-1.5 font-semibold">₹{r.amountToHotel.toFixed(2)}</td>
                </tr>
              ))}
              {data.rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="border border-slate-200 px-3 py-6 text-center text-slate-400">
                    No OTA bookings in this range
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <p className="mt-4 rounded-lg bg-emerald-100 py-2 text-center text-sm font-bold text-emerald-800">
            Month-to-Date Revenue (Including Today): ₹{data.monthToDateRevenue.toLocaleString('en-IN')}
          </p>
        </ReportPrintShell>
      )}
    </div>
  );
}

interface OtaRevenueRow {
  source: string;
  bookings: number;
  nights: number;
  gross: number;
  commissionPercent: number;
  commission: number;
  net: number;
  paid: number;
  pending: number;
}

export function OtaRevenueReport({ hotelId }: { hotelId: string }) {
  const { token } = useAuth();
  const [from, setFrom] = useState(todayPlus(0));
  const [to, setTo] = useState(todayPlus(0));
  const [source, setSource] = useState('');
  const [data, setData] = useState<{
    totalRooms: number;
    totalRevenue: number;
    collected: number;
    pending: number;
    commission: number;
    netPayment: number;
    rows: OtaRevenueRow[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      setData(await query('reports.otaRevenue', { hotelId, from, to, source: source || undefined }, token ?? undefined));
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
      <PageHeader title="OTA Revenue Report" subtitle="View details of OTA revenue report" />
      <Card className="mb-4">
        <CardBody>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button onClick={run} disabled={loading} title="Refresh" className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-brand-600 hover:bg-slate-50 disabled:opacity-50">
              ⟳
            </button>
            <select className={`${inputClass} w-40`} value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">All Sources</option>
              {Object.entries(SOURCE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <ReportDateRangePill from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
          </div>
        </CardBody>
      </Card>

      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {data && (
        <>
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Card className="bg-brand-50 px-5 py-4">
              <p className="text-sm font-semibold text-slate-500">{data.totalRooms} Rooms</p>
              <div className="mt-1 flex items-center justify-between">
                <p className="text-sm font-medium text-slate-700">Total Revenue</p>
                <p className="text-xl font-bold text-slate-900">₹{data.totalRevenue.toLocaleString('en-IN')}</p>
              </div>
            </Card>
            <Card className="px-5 py-4">
              <p className="text-xs font-medium text-slate-500">Collected</p>
              <p className="mt-1 text-xl font-bold text-emerald-600">₹{data.collected.toLocaleString('en-IN')}</p>
            </Card>
            <Card className="px-5 py-4">
              <p className="text-xs font-medium text-slate-500">Pending</p>
              <p className="mt-1 text-xl font-bold text-amber-600">₹{data.pending.toLocaleString('en-IN')}</p>
            </Card>
          </div>
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Card className="px-5 py-4">
              <p className="text-xs font-medium text-slate-500">OTA Commission</p>
              <p className="mt-1 text-xl font-bold text-slate-900">₹{data.commission.toLocaleString('en-IN')}</p>
            </Card>
            <Card className="px-5 py-4">
              <p className="text-xs font-medium text-slate-500">Net Payment</p>
              <p className="mt-1 text-xl font-bold text-slate-900">₹{data.netPayment.toFixed(2)}</p>
            </Card>
          </div>

          <Card className="overflow-hidden">
            {data.rows.length === 0 ? (
              <CardBody>
                <EmptyState title="No bookings in this range" />
              </CardBody>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-brand-50 text-left text-xs font-semibold text-brand-800">
                      <th className="px-5 py-3">OTA</th>
                      <th className="px-5 py-3">Bookings</th>
                      <th className="px-5 py-3">Revenue</th>
                      <th className="px-5 py-3">Payments</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.rows.map((r) => (
                      <tr key={r.source} className="hover:bg-slate-50">
                        <td className="px-5 py-3 font-medium text-slate-900">{SOURCE_LABEL[r.source] ?? r.source}</td>
                        <td className="px-5 py-3 text-slate-600">
                          {r.bookings} bookings
                          <br />
                          <span className="text-xs text-slate-400">{r.nights} room nights</span>
                        </td>
                        <td className="px-5 py-3 text-slate-600">
                          Gross: ₹{r.gross.toLocaleString('en-IN')}
                          <br />
                          <span className="text-xs text-slate-400">
                            Commission: {r.commissionPercent.toFixed(0)}% (₹{r.commission.toFixed(0)})
                          </span>
                          <br />
                          <span className="font-bold text-slate-900">Net: ₹{r.net.toFixed(2)}</span>
                        </td>
                        <td className="px-5 py-3 text-slate-600">
                          Paid: ₹{r.paid.toLocaleString('en-IN')}
                          <br />
                          <span className="text-xs text-slate-400">Pending: ₹{r.pending.toLocaleString('en-IN')}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

