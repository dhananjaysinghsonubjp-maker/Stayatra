import { useEffect, useState } from 'react';
import { query, ApiError } from '../../api';
import { useAuth } from '../../AuthContext';
import { Badge, Card, CardBody, EmptyState, Field, PageHeader, inputClass } from '../../components/ui';
import { formatDateShort, formatDateTimeShort } from '../../dateFormat';
import { PAYMENT_METHODS, paymentMethodLabel } from '../../paymentMethods';
import { ReportPrintShell } from './ReportPrintShell';
import { DateRangeBar, todayPlus } from './DocumentReports';
import type { PaymentMethod, PaymentType } from '../../types';

// ───────────────────────── Advance Received Report ─────────────────────────

interface AdvanceRow {
  id: string;
  date: string;
  receiptNo: string;
  guestName: string;
  amount: number;
  remark: string;
}

export function AdvanceReceivedReport({ hotelId }: { hotelId: string }) {
  const { token } = useAuth();
  const [from, setFrom] = useState(todayPlus(0));
  const [to, setTo] = useState(todayPlus(0));
  const [data, setData] = useState<{ rows: AdvanceRow[]; totalAdvance: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      setData(await query('reports.advanceReceived', { hotelId, from, to }, token ?? undefined));
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
      <PageHeader title="Advance Received Report" subtitle="Every advance payment collected in the selected range" />
      <DateRangeBar from={from} to={to} setFrom={setFrom} setTo={setTo} onRefresh={run} loading={loading} />
      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {data && (
        <ReportPrintShell hotelId={hotelId} title="Advance Received Report">
          <h2 className="mb-1 text-lg font-bold text-slate-900">Advance Received Report</h2>
          <p className="mb-3 text-xs text-slate-500">Advance Payments Summary</p>
          <div className="mb-3 flex gap-2 text-xs">
            <span className="rounded border border-slate-200 px-2 py-1">From: {formatDateShort(from)}</span>
            <span className="rounded border border-slate-200 px-2 py-1">To: {formatDateShort(to)}</span>
          </div>
          <p className="mb-4 rounded-lg border border-slate-200 py-2 text-center text-sm font-bold text-slate-800">Total Advance: ₹{data.totalAdvance.toFixed(2)}</p>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-brand-600 text-left text-white">
                <th className="border border-brand-700 px-3 py-2">#</th>
                <th className="border border-brand-700 px-3 py-2">Date</th>
                <th className="border border-brand-700 px-3 py-2">Receipt No</th>
                <th className="border border-brand-700 px-3 py-2">Guest Name</th>
                <th className="border border-brand-700 px-3 py-2">Amount</th>
                <th className="border border-brand-700 px-3 py-2">Remark</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr key={r.id} className="even:bg-slate-50">
                  <td className="border border-slate-200 px-3 py-1.5">{i + 1}</td>
                  <td className="border border-slate-200 px-3 py-1.5">{formatDateShort(r.date)}</td>
                  <td className="border border-slate-200 px-3 py-1.5">{r.receiptNo}</td>
                  <td className="border border-slate-200 px-3 py-1.5">{r.guestName}</td>
                  <td className="border border-slate-200 px-3 py-1.5">₹{r.amount.toFixed(2)}</td>
                  <td className="border border-slate-200 px-3 py-1.5">{r.remark}</td>
                </tr>
              ))}
              {data.rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="border border-slate-200 px-3 py-6 text-center text-slate-400">
                    No advance data available
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </ReportPrintShell>
      )}
    </div>
  );
}

// ───────────────────────────── Room Sale Report ─────────────────────────────

interface RoomSaleRow {
  id: string;
  invoiceDate: string;
  invoiceNumber: string;
  guestName: string;
  gstNo: string | null;
  checkIn: string;
  checkOut: string;
  roomNumber: string;
  roomTariff: number;
  nights: number;
  baseAmount: number;
  cgst: number;
  sgst: number;
  grandTotal: number;
  commissionPayable: number;
  modeOfPayment: PaymentMethod | null;
}

export function RoomSaleReport({ hotelId }: { hotelId: string }) {
  const { token } = useAuth();
  const [from, setFrom] = useState(todayPlus(-29));
  const [to, setTo] = useState(todayPlus(0));
  const [data, setData] = useState<{ rows: RoomSaleRow[]; summary: Record<string, number> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      setData(await query('reports.roomSale', { hotelId, from, to }, token ?? undefined));
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
      <PageHeader title="Room Sale Report" subtitle="Tax-invoice style breakdown per room booking, by check-in day" />
      <DateRangeBar from={from} to={to} setFrom={setFrom} setTo={setTo} onRefresh={run} loading={loading} />
      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {data && (
        <ReportPrintShell hotelId={hotelId} title="Room Sale Report">
          <div className="mb-4 flex items-start justify-between">
            <h2 className="text-lg font-bold text-slate-900">Room Sale Report</h2>
            <p className="text-xs text-slate-500">
              {formatDateShort(from)} to {formatDateShort(to)}
            </p>
          </div>
          <div className="mb-4 grid grid-cols-4 gap-2 rounded-lg bg-slate-50 p-3 text-center text-xs sm:grid-cols-8">
            {[
              ['Total Bookings', data.summary.totalBookings],
              ['Total Rooms', data.summary.totalRooms],
              ['Total Nights', data.summary.totalNights],
              ['Total Base', `₹${data.summary.totalBase.toFixed(2)}`],
              ['Total CGST', `₹${data.summary.totalCgst.toFixed(2)}`],
              ['Total SGST', `₹${data.summary.totalSgst.toFixed(2)}`],
              ['Grand Total', `₹${data.summary.grandTotal.toFixed(2)}`],
              ['Commission', `₹${data.summary.totalCommission.toFixed(2)}`],
            ].map(([label, value]) => (
              <div key={label as string}>
                <p className="text-slate-500">{label}</p>
                <p className="font-bold text-slate-900">{value}</p>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-brand-600 text-left text-white">
                  {['Invoice Date', 'Invoice Number', 'Guest Name', 'GST No', 'Check-in', 'Check-out', 'Room No', 'Room Tariff', 'Nights', 'Base Amount', 'CGST', 'SGST', 'Grand Total', 'Commission Payable', 'Mode of Payment'].map((h) => (
                    <th key={h} className="border border-brand-700 px-2 py-2 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id} className="even:bg-slate-50">
                    <td className="border border-slate-200 px-2 py-1.5 whitespace-nowrap">{formatDateTimeShort(r.invoiceDate)}</td>
                    <td className="border border-slate-200 px-2 py-1.5 whitespace-nowrap">{r.invoiceNumber}</td>
                    <td className="border border-slate-200 px-2 py-1.5">{r.guestName}</td>
                    <td className="border border-slate-200 px-2 py-1.5">{r.gstNo ?? '—'}</td>
                    <td className="border border-slate-200 px-2 py-1.5 whitespace-nowrap">{formatDateTimeShort(r.checkIn)}</td>
                    <td className="border border-slate-200 px-2 py-1.5 whitespace-nowrap">{formatDateTimeShort(r.checkOut)}</td>
                    <td className="border border-slate-200 px-2 py-1.5">{r.roomNumber}</td>
                    <td className="border border-slate-200 px-2 py-1.5">₹{r.roomTariff.toFixed(2)}</td>
                    <td className="border border-slate-200 px-2 py-1.5">{r.nights}</td>
                    <td className="border border-slate-200 px-2 py-1.5">₹{r.baseAmount.toFixed(2)}</td>
                    <td className="border border-slate-200 px-2 py-1.5">₹{r.cgst.toFixed(2)}</td>
                    <td className="border border-slate-200 px-2 py-1.5">₹{r.sgst.toFixed(2)}</td>
                    <td className="border border-slate-200 px-2 py-1.5 font-semibold">₹{r.grandTotal.toFixed(2)}</td>
                    <td className="border border-slate-200 px-2 py-1.5">₹{r.commissionPayable.toFixed(2)}</td>
                    <td className="border border-slate-200 px-2 py-1.5">{r.modeOfPayment ? paymentMethodLabel(r.modeOfPayment) : '—'}</td>
                  </tr>
                ))}
                {data.rows.length === 0 && (
                  <tr>
                    <td colSpan={15} className="border border-slate-200 px-2 py-6 text-center text-slate-400">
                      No data found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-4 rounded-lg bg-brand-50 py-2 text-center text-sm font-bold text-brand-700">Total Revenue (Date Range): ₹{data.summary.grandTotal.toFixed(2)}</p>
        </ReportPrintShell>
      )}
    </div>
  );
}

// ───────────────────────────── GST Bill Report ─────────────────────────────

interface GstBillRow {
  id: string;
  gstNo: string;
  receiverName: string;
  invoiceDate: string;
  invoiceNumber: string;
  guestName: string;
  checkIn: string;
  checkOut: string;
  rooms: number;
  nights: number;
  baseValue: number;
  cgst: number;
  sgst: number;
  invoiceValue: number;
}

export function GstBillReport({ hotelId }: { hotelId: string }) {
  const { token } = useAuth();
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`);
  const [to, setTo] = useState(todayPlus(0));
  const [rows, setRows] = useState<GstBillRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      setRows(await query('reports.gstBill', { hotelId, from, to }, token ?? undefined));
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
      <PageHeader title="GST Bill Report" subtitle="Invoices billed to a company GSTIN, for their input credit" />
      <DateRangeBar from={from} to={to} setFrom={setFrom} setTo={setTo} onRefresh={run} loading={loading} />
      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {rows && (
        <ReportPrintShell hotelId={hotelId} title="GST Bill Report">
          <h2 className="mb-1 text-lg font-bold text-slate-900">GST Booking Report</h2>
          <div className="mb-3 flex gap-2 text-xs">
            <span className="rounded border border-slate-200 px-2 py-1">From: {formatDateShort(from)}</span>
            <span className="rounded border border-slate-200 px-2 py-1">To: {formatDateShort(to)}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-brand-600 text-left text-white">
                  {['#', 'GST No', 'Receiver Name', 'Invoice Date', 'Invoice No', 'Guest Name', 'Check-In', 'Check-Out', 'Rooms', 'Nights', 'Base Value', 'CGST', 'SGST', 'Invoice Value'].map((h) => (
                    <th key={h} className="border border-brand-700 px-2 py-2 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id} className="even:bg-slate-50">
                    <td className="border border-slate-200 px-2 py-1.5">{i + 1}</td>
                    <td className="border border-slate-200 px-2 py-1.5">{r.gstNo}</td>
                    <td className="border border-slate-200 px-2 py-1.5">{r.receiverName}</td>
                    <td className="border border-slate-200 px-2 py-1.5 whitespace-nowrap">{formatDateShort(r.invoiceDate)}</td>
                    <td className="border border-slate-200 px-2 py-1.5">{r.invoiceNumber}</td>
                    <td className="border border-slate-200 px-2 py-1.5">{r.guestName}</td>
                    <td className="border border-slate-200 px-2 py-1.5 whitespace-nowrap">{formatDateShort(r.checkIn)}</td>
                    <td className="border border-slate-200 px-2 py-1.5 whitespace-nowrap">{formatDateShort(r.checkOut)}</td>
                    <td className="border border-slate-200 px-2 py-1.5">{r.rooms}</td>
                    <td className="border border-slate-200 px-2 py-1.5">{r.nights}</td>
                    <td className="border border-slate-200 px-2 py-1.5">₹{r.baseValue.toFixed(2)}</td>
                    <td className="border border-slate-200 px-2 py-1.5">₹{r.cgst.toFixed(2)}</td>
                    <td className="border border-slate-200 px-2 py-1.5">₹{r.sgst.toFixed(2)}</td>
                    <td className="border border-slate-200 px-2 py-1.5 font-semibold">₹{r.invoiceValue.toFixed(2)}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={14} className="border border-slate-200 px-2 py-6 text-center text-slate-400">
                      No GST bookings found for the selected date range
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

// ──────────────────────────── Payment Receipts ────────────────────────────

interface ReceiptRow {
  id: string;
  receiptNo: string;
  receiptDate: string;
  bookingCode: string;
  guestName: string;
  checkIn: string;
  checkOut: string;
  roomNumber: string;
  paymentType: PaymentType;
  paymentMethod: PaymentMethod;
  amount: number;
}

export function PaymentReceiptsReport({ hotelId }: { hotelId: string }) {
  const { token } = useAuth();
  const [from, setFrom] = useState(todayPlus(-29));
  const [to, setTo] = useState(todayPlus(0));
  const [search, setSearch] = useState('');
  const [paymentType, setPaymentType] = useState<PaymentType | ''>('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | ''>('');
  const [rows, setRows] = useState<ReceiptRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      setRows(await query('reports.paymentReceipts', { hotelId, from, to }, token ?? undefined));
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

  const filtered = (rows ?? []).filter((r) => {
    if (search && !r.receiptNo.toLowerCase().includes(search.toLowerCase()) && !r.bookingCode.toLowerCase().includes(search.toLowerCase())) return false;
    if (paymentType && r.paymentType !== paymentType) return false;
    if (paymentMethod && r.paymentMethod !== paymentMethod) return false;
    return true;
  });

  return (
    <div>
      <PageHeader title="Payment Receipts" subtitle="Every payment collected, searchable receipt by receipt" />
      <Card className="mb-4">
        <CardBody>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Search Receipt No. / Booking">
              <input className={`${inputClass} w-56`} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. BK-A1B2C3" />
            </Field>
            <Field label="Date Range">
              <div className="flex items-center gap-1.5">
                <input type="date" className={`${inputClass} w-36`} value={from} onChange={(e) => setFrom(e.target.value)} />
                <span className="text-slate-400">–</span>
                <input type="date" className={`${inputClass} w-36`} value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
            </Field>
            <Field label="Payment Type">
              <select className={`${inputClass} w-40`} value={paymentType} onChange={(e) => setPaymentType(e.target.value as PaymentType | '')}>
                <option value="">All Types</option>
                <option value="advance">Advance</option>
                <option value="partial">Partial</option>
                <option value="full">Full</option>
              </select>
            </Field>
            <Field label="Payment Mode">
              <select className={`${inputClass} w-40`} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod | '')}>
                <option value="">All Modes</option>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </Field>
            <button onClick={run} disabled={loading} title="Refresh" className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-brand-600 hover:bg-slate-50 disabled:opacity-50">
              ⟳
            </button>
            <span className="ml-auto rounded-full bg-brand-50 px-3 py-1.5 text-xs font-bold text-brand-700">{filtered.length} Found</span>
          </div>
        </CardBody>
      </Card>

      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <Card className="overflow-hidden">
        {filtered.length === 0 ? (
          <CardBody>
            <EmptyState title={rows ? 'No receipts match these filters' : 'Loading…'} />
          </CardBody>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-brand-50 text-left text-xs font-semibold text-brand-800">
                  <th className="px-4 py-3">Receipt No.</th>
                  <th className="px-4 py-3">Receipt Date</th>
                  <th className="px-4 py-3">Booking ID</th>
                  <th className="px-4 py-3">Guest Name</th>
                  <th className="px-4 py-3">Check-in</th>
                  <th className="px-4 py-3">Check-out</th>
                  <th className="px-4 py-3">Room</th>
                  <th className="px-4 py-3">Payment Type</th>
                  <th className="px-4 py-3">Payment Mode</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-bold text-brand-700">{r.receiptNo}</td>
                    <td className="px-4 py-3 text-slate-500">{formatDateTimeShort(r.receiptDate)}</td>
                    <td className="px-4 py-3">{r.bookingCode}</td>
                    <td className="px-4 py-3 font-medium text-slate-900">{r.guestName}</td>
                    <td className="px-4 py-3">{formatDateShort(r.checkIn)}</td>
                    <td className="px-4 py-3">{formatDateShort(r.checkOut)}</td>
                    <td className="px-4 py-3">{r.roomNumber}</td>
                    <td className="px-4 py-3">
                      <Badge tone="connected">{r.paymentType === 'advance' ? 'Advance Payment' : r.paymentType === 'full' ? 'Full Payment' : 'Part Payment'}</Badge>
                    </td>
                    <td className="px-4 py-3">{paymentMethodLabel(r.paymentMethod)}</td>
                    <td className="px-4 py-3 text-right font-semibold">₹{r.amount.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ──────────────────────────── Profit And Loss ────────────────────────────

interface PnlData {
  netRevenue: number;
  commission: number;
  gst: number;
  grossRevenue: number;
  expenses: { category: string; amount: number }[];
  totalExpenses: number;
  netProfit: number;
}

export function ProfitAndLossReport({ hotelId }: { hotelId: string }) {
  const { token } = useAuth();
  const [from, setFrom] = useState(todayPlus(0));
  const [to, setTo] = useState(todayPlus(0));
  const [data, setData] = useState<PnlData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      setData(await query('reports.profitAndLoss', { hotelId, from, to }, token ?? undefined));
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
      <PageHeader title="Profit And Loss Report" subtitle="Revenue against logged operating expenses for the selected range" />
      <DateRangeBar from={from} to={to} setFrom={setFrom} setTo={setTo} onRefresh={run} loading={loading} />
      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {data && (
        <ReportPrintShell hotelId={hotelId} title="Profit And Loss Report">
          <h2 className="mb-1 text-center text-xl font-bold text-brand-700">Profit &amp; Loss Statement</h2>
          <p className="mb-4 text-center text-xs text-slate-500">
            Period: {formatDateShort(from)} to {formatDateShort(to)}
          </p>

          <p className="mb-2 bg-brand-600 px-3 py-2 text-sm font-bold text-white">1. Revenue</p>
          <table className="mb-5 w-full border-collapse text-sm">
            <tbody>
              {[
                ['Net Revenue (After Discount)', data.netRevenue],
                ['Commission Amount', data.commission],
                ['Total GST Collected', data.gst],
              ].map(([label, value]) => (
                <tr key={label as string} className="even:bg-slate-50">
                  <td className="border border-slate-200 px-3 py-1.5 text-slate-600">{label}</td>
                  <td className="border border-slate-200 px-3 py-1.5 text-right">₹{(value as number).toFixed(2)}</td>
                </tr>
              ))}
              <tr className="bg-brand-50 font-bold">
                <td className="border border-slate-200 px-3 py-2">Gross Revenue (Including Tax)</td>
                <td className="border border-slate-200 px-3 py-2 text-right">₹{data.grossRevenue.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>

          <p className="mb-2 bg-brand-600 px-3 py-2 text-sm font-bold text-white">2. Operating Expenses</p>
          <table className="mb-5 w-full border-collapse text-sm">
            <thead>
              <tr className="bg-slate-100 text-left">
                <th className="border border-slate-200 px-3 py-2">Expense Category</th>
                <th className="border border-slate-200 px-3 py-2 text-right">Amount (₹)</th>
              </tr>
            </thead>
            <tbody>
              {data.expenses.map((e) => (
                <tr key={e.category} className="even:bg-slate-50">
                  <td className="border border-slate-200 px-3 py-1.5">{e.category}</td>
                  <td className="border border-slate-200 px-3 py-1.5 text-right">₹{e.amount.toFixed(2)}</td>
                </tr>
              ))}
              {data.expenses.length === 0 && (
                <tr>
                  <td colSpan={2} className="border border-slate-200 px-3 py-6 text-center text-slate-400">
                    No operating expenses available
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 font-bold">
                <td className="border border-slate-200 px-3 py-2">Total Operating Expenses</td>
                <td className="border border-slate-200 px-3 py-2 text-right">₹{data.totalExpenses.toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>

          {/* §user request, with a reference app's own P&L layout as the target — a third "Profit
              Summary" section instead of a single NET PROFIT bar. Reinvestment has no backing data
              anywhere in this app (no such ledger concept exists), so it's a fixed ₹0 for now —
              before and after reinvestment are the same number until that's ever tracked. */}
          <p className="mb-2 bg-brand-600 px-3 py-2 text-sm font-bold text-white">3. Profit Summary</p>
          <table className="w-full border-collapse text-sm">
            <tbody>
              <tr className="bg-brand-50">
                <td className="border border-slate-200 px-3 py-2 font-bold text-slate-900">Net Profit (Before Reinvestment)</td>
                <td className="border border-slate-200 px-3 py-2 text-right font-bold text-emerald-600">₹{data.netProfit.toFixed(2)}</td>
              </tr>
              <tr>
                <td className="border border-slate-200 px-3 py-1.5 text-slate-600">Reinvestment</td>
                <td className="border border-slate-200 px-3 py-1.5 text-right">₹0.00</td>
              </tr>
              <tr className="bg-brand-50">
                <td className="border border-slate-200 px-3 py-2 font-bold text-slate-900">Net Profit (After Reinvestment)</td>
                <td className="border border-slate-200 px-3 py-2 text-right font-bold text-emerald-600">₹{data.netProfit.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
        </ReportPrintShell>
      )}
    </div>
  );
}

// ──────────────────────────── Credit and Debit ────────────────────────────

interface CreditDebitRow {
  id: string;
  date: string;
  description: string;
  method: string;
  amount: number;
  type: 'cash_in' | 'cash_out';
}

export function CreditAndDebitReport({ hotelId }: { hotelId: string }) {
  const { token } = useAuth();
  const [from, setFrom] = useState(todayPlus(0));
  const [to, setTo] = useState(todayPlus(0));
  const [data, setData] = useState<{ totalCredit: number; totalDebit: number; netBalance: number; rows: CreditDebitRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      setData(await query('reports.creditAndDebit', { hotelId, from, to }, token ?? undefined));
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
      <PageHeader title="Credit And Debit" subtitle={data ? `${data.rows.length} Found` : undefined} />
      {data && (
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Card className="px-5 py-4">
            <p className="text-xs font-medium text-slate-500">Total Credit</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600">₹{data.totalCredit.toLocaleString('en-IN')}</p>
          </Card>
          <Card className="px-5 py-4">
            <p className="text-xs font-medium text-slate-500">Total Debit</p>
            <p className="mt-1 text-2xl font-bold text-red-600">₹{data.totalDebit.toLocaleString('en-IN')}</p>
          </Card>
          <Card className="px-5 py-4">
            <p className="text-xs font-medium text-slate-500">Net Balance</p>
            <p className="mt-1 text-2xl font-bold text-brand-700">₹{data.netBalance.toLocaleString('en-IN')}</p>
          </Card>
        </div>
      )}
      <DateRangeBar from={from} to={to} setFrom={setFrom} setTo={setTo} onRefresh={run} loading={loading} />
      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      <Card className="overflow-hidden">
        {!data || data.rows.length === 0 ? (
          <CardBody>
            <EmptyState title={data ? 'No transactions in this range' : 'Loading…'} />
          </CardBody>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-brand-50 text-left text-xs font-semibold text-brand-800">
                  <th className="px-5 py-3">Description</th>
                  <th className="px-5 py-3 text-right">Financial</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <p className="font-medium text-slate-900">{r.description}</p>
                      <p className="text-xs text-slate-400">{formatDateTimeShort(r.date)}</p>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <p className={`font-bold ${r.type === 'cash_in' ? 'text-emerald-600' : 'text-red-600'}`}>₹{r.amount.toFixed(2)}</p>
                      <p className="text-xs text-slate-400">{paymentMethodLabel(r.method as PaymentMethod)}</p>
                      <Badge tone={r.type === 'cash_in' ? 'available' : 'error'}>{r.type === 'cash_in' ? 'Credit' : 'Debit'}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ─────────────────────────── Room Wise Revenue ───────────────────────────

interface RoomRevenueRow {
  roomId: string;
  roomNumber: string;
  roomType: string;
  occupiedNights: number;
  availableNights: number;
  occupancyPercent: number;
  roomRevenue: number;
  otherRevenue: number;
  totalRevenue: number;
}

export function RoomWiseRevenueReport({ hotelId }: { hotelId: string }) {
  const { token } = useAuth();
  const [from, setFrom] = useState(todayPlus(0));
  const [to, setTo] = useState(todayPlus(0));
  const [data, setData] = useState<{ rows: RoomRevenueRow[]; summary: Record<string, number> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      setData(await query('reports.roomWiseRevenue', { hotelId, from, to }, token ?? undefined));
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
      <PageHeader title="Room Wise Revenue Report" subtitle="Occupancy and revenue, per room, for the selected range" />
      <DateRangeBar from={from} to={to} setFrom={setFrom} setTo={setTo} onRefresh={run} loading={loading} />
      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {data && (
        <ReportPrintShell hotelId={hotelId} title="Room Wise Revenue Report">
          <div className="mb-4 flex items-start justify-between">
            <h2 className="text-lg font-bold text-slate-900">Room Wise Revenue Report</h2>
            <p className="text-xs text-slate-500">
              {formatDateShort(from)} to {formatDateShort(to)}
            </p>
          </div>
          <div className="mb-4 grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-3 text-center text-xs sm:grid-cols-7">
            {[
              ['Total Rooms', data.summary.totalRooms],
              ['Occupied Nights', data.summary.occupiedNights],
              ['Available Nights', data.summary.availableNights],
              ['Avg Occupancy', `${data.summary.avgOccupancy.toFixed(2)}%`],
              ['Room Revenue', `₹${data.summary.roomRevenue.toFixed(2)}`],
              ['Other Revenue', `₹${data.summary.otherRevenue.toFixed(2)}`],
              ['Total Revenue', `₹${data.summary.totalRevenue.toFixed(2)}`],
            ].map(([label, value]) => (
              <div key={label as string}>
                <p className="text-slate-500">{label}</p>
                <p className="font-bold text-slate-900">{value}</p>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-brand-600 text-left text-white">
                  {['Room Number', 'Room Type', 'Occupied Nights', 'Available Nights', 'Occupancy %', 'Room Revenue', 'Other Revenue', 'Total Revenue'].map((h) => (
                    <th key={h} className="border border-brand-700 px-2 py-2 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.roomId} className="even:bg-slate-50">
                    <td className="border border-slate-200 px-2 py-1.5">{r.roomNumber}</td>
                    <td className="border border-slate-200 px-2 py-1.5">{r.roomType}</td>
                    <td className="border border-slate-200 px-2 py-1.5">{r.occupiedNights}</td>
                    <td className="border border-slate-200 px-2 py-1.5">{r.availableNights}</td>
                    <td className="border border-slate-200 px-2 py-1.5">{r.occupancyPercent.toFixed(2)} %</td>
                    <td className="border border-slate-200 px-2 py-1.5">₹{r.roomRevenue.toFixed(2)}</td>
                    <td className="border border-slate-200 px-2 py-1.5">₹{r.otherRevenue.toFixed(2)}</td>
                    <td className="border border-slate-200 px-2 py-1.5 font-semibold">₹{r.totalRevenue.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 rounded-lg bg-brand-50 py-2 text-center text-sm font-bold text-brand-700">Total Revenue: ₹{data.summary.totalRevenue.toFixed(2)}</p>
        </ReportPrintShell>
      )}
    </div>
  );
}

// ──────────────────────────────── Invoice Bills ────────────────────────────────

interface InvoiceBillRow {
  id: string;
  invoiceNumber: string;
  guestName: string;
  roomNumber: string;
  checkIn: string;
  checkOut: string;
  total: number;
  paid: number;
  due: number;
  status: 'Paid' | 'Partially Paid' | 'Unpaid';
}

export function InvoiceBillsReport({ hotelId }: { hotelId: string }) {
  const { token } = useAuth();
  const [from, setFrom] = useState(todayPlus(-29));
  const [to, setTo] = useState(todayPlus(0));
  const [rows, setRows] = useState<InvoiceBillRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      setRows(await query('reports.invoiceBills', { hotelId, from, to }, token ?? undefined));
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
      <PageHeader title="Invoice Bills" subtitle="Every invoice raised, with its payment status" />
      <DateRangeBar from={from} to={to} setFrom={setFrom} setTo={setTo} onRefresh={run} loading={loading} />
      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {rows && (
        <ReportPrintShell hotelId={hotelId} title="Invoice Bills">
          <h2 className="mb-3 text-lg font-bold text-slate-900">Invoice Bills</h2>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-brand-600 text-left text-white">
                {['Invoice No', 'Guest Name', 'Room', 'Check-in', 'Check-out', 'Total', 'Paid', 'Due', 'Status'].map((h) => (
                  <th key={h} className="border border-brand-700 px-2 py-2 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="even:bg-slate-50">
                  <td className="border border-slate-200 px-2 py-1.5">{r.invoiceNumber}</td>
                  <td className="border border-slate-200 px-2 py-1.5">{r.guestName}</td>
                  <td className="border border-slate-200 px-2 py-1.5">{r.roomNumber}</td>
                  <td className="border border-slate-200 px-2 py-1.5 whitespace-nowrap">{formatDateShort(r.checkIn)}</td>
                  <td className="border border-slate-200 px-2 py-1.5 whitespace-nowrap">{formatDateShort(r.checkOut)}</td>
                  <td className="border border-slate-200 px-2 py-1.5">₹{r.total.toFixed(2)}</td>
                  <td className="border border-slate-200 px-2 py-1.5">₹{r.paid.toFixed(2)}</td>
                  <td className="border border-slate-200 px-2 py-1.5">₹{r.due.toFixed(2)}</td>
                  <td className="border border-slate-200 px-2 py-1.5">{r.status}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="border border-slate-200 px-2 py-6 text-center text-slate-400">
                    No invoices in this range
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </ReportPrintShell>
      )}
    </div>
  );
}

// ──────────────────────────────── Payment Report ────────────────────────────────

interface PaymentReportRow {
  id: string;
  date: string;
  guestName: string;
  bookingCode: string;
  roomNumber: string;
  method: PaymentMethod;
  reference: string | null;
  amount: number;
}

export function PaymentReport({ hotelId }: { hotelId: string }) {
  const { token } = useAuth();
  const [from, setFrom] = useState(todayPlus(0));
  const [to, setTo] = useState(todayPlus(0));
  const [data, setData] = useState<{ rows: PaymentReportRow[]; total: number; byMethod: { method: string; amount: number }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      setData(await query('reports.paymentReport', { hotelId, from, to }, token ?? undefined));
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
      <PageHeader title="Payment Report" subtitle="Payments collected in the range, with a by-method summary" />
      <DateRangeBar from={from} to={to} setFrom={setFrom} setTo={setTo} onRefresh={run} loading={loading} />
      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {data && (
        <ReportPrintShell hotelId={hotelId} title="Payment Report">
          <h2 className="mb-3 text-lg font-bold text-slate-900">Payment Report</h2>
          <div className="mb-4 flex flex-wrap gap-2">
            {data.byMethod.map((m) => (
              <span key={m.method} className="rounded-lg bg-slate-50 px-3 py-1.5 text-xs">
                {paymentMethodLabel(m.method as PaymentMethod)}: <span className="font-bold">₹{m.amount.toFixed(2)}</span>
              </span>
            ))}
          </div>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-brand-600 text-left text-white">
                {['Date', 'Guest Name', 'Booking', 'Room', 'Method', 'Reference', 'Amount'].map((h) => (
                  <th key={h} className="border border-brand-700 px-3 py-2">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} className="even:bg-slate-50">
                  <td className="border border-slate-200 px-3 py-1.5">{formatDateTimeShort(r.date)}</td>
                  <td className="border border-slate-200 px-3 py-1.5">{r.guestName}</td>
                  <td className="border border-slate-200 px-3 py-1.5">{r.bookingCode}</td>
                  <td className="border border-slate-200 px-3 py-1.5">{r.roomNumber}</td>
                  <td className="border border-slate-200 px-3 py-1.5">{paymentMethodLabel(r.method)}</td>
                  <td className="border border-slate-200 px-3 py-1.5">{r.reference ?? '—'}</td>
                  <td className="border border-slate-200 px-3 py-1.5">₹{r.amount.toFixed(2)}</td>
                </tr>
              ))}
              {data.rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="border border-slate-200 px-3 py-6 text-center text-slate-400">
                    No payments in this range
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="bg-brand-50 font-bold">
                <td className="border border-slate-200 px-3 py-2" colSpan={6}>
                  Total
                </td>
                <td className="border border-slate-200 px-3 py-2">₹{data.total.toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>
        </ReportPrintShell>
      )}
    </div>
  );
}

// ──────────────────────────────── Account Book ────────────────────────────────

interface LedgerRow {
  id: string;
  date: string;
  description: string;
  type: 'cash_in' | 'cash_out';
  amount: number;
}

export function AccountBookReport({ hotelId }: { hotelId: string }) {
  const { token } = useAuth();
  const [from, setFrom] = useState(todayPlus(0));
  const [to, setTo] = useState(todayPlus(0));
  const [data, setData] = useState<{ opening: number; closing: number; periodCredit: number; periodDebit: number; rows: LedgerRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      setData(await query('reports.accountBook', { hotelId, from, to }, token ?? undefined));
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
      <PageHeader title="Account Book Report" subtitle="Opening balance, every transaction, and the resulting closing balance" />
      <DateRangeBar from={from} to={to} setFrom={setFrom} setTo={setTo} onRefresh={run} loading={loading} />
      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {data && (
        <ReportPrintShell hotelId={hotelId} title="Account Book Report">
          <h2 className="mb-4 text-lg font-bold text-slate-900">Account Book Report</h2>
          <div className="mb-4 grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 text-center text-xs sm:grid-cols-4">
            {[
              ['Opening Balance', data.opening],
              ['Credit (Period)', data.periodCredit],
              ['Debit (Period)', data.periodDebit],
              ['Closing Balance', data.closing],
            ].map(([label, value]) => (
              <div key={label as string}>
                <p className="text-slate-500">{label}</p>
                <p className="font-bold text-slate-900">₹{(value as number).toFixed(2)}</p>
              </div>
            ))}
          </div>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-brand-600 text-left text-white">
                <th className="border border-brand-700 px-3 py-2">Date</th>
                <th className="border border-brand-700 px-3 py-2">Description</th>
                <th className="border border-brand-700 px-3 py-2 text-right">Credit</th>
                <th className="border border-brand-700 px-3 py-2 text-right">Debit</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} className="even:bg-slate-50">
                  <td className="border border-slate-200 px-3 py-1.5">{formatDateTimeShort(r.date)}</td>
                  <td className="border border-slate-200 px-3 py-1.5">{r.description}</td>
                  <td className="border border-slate-200 px-3 py-1.5 text-right text-emerald-600">{r.type === 'cash_in' ? `₹${r.amount.toFixed(2)}` : ''}</td>
                  <td className="border border-slate-200 px-3 py-1.5 text-right text-red-600">{r.type === 'cash_out' ? `₹${r.amount.toFixed(2)}` : ''}</td>
                </tr>
              ))}
              {data.rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="border border-slate-200 px-3 py-6 text-center text-slate-400">
                    No transactions in this range
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </ReportPrintShell>
      )}
    </div>
  );
}

// ────────────────────────── Advance Adjustment Report ──────────────────────────

interface AdjustmentRow {
  id: string;
  bookingCode: string;
  guestName: string;
  roomNumber: string;
  advanceReceived: number;
  adjustedAgainstStay: number;
  balanceDue: number;
}

export function AdvanceAdjustmentReport({ hotelId }: { hotelId: string }) {
  const { token } = useAuth();
  const [from, setFrom] = useState(todayPlus(-29));
  const [to, setTo] = useState(todayPlus(0));
  const [rows, setRows] = useState<AdjustmentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      setRows(await query('reports.advanceAdjustment', { hotelId, from, to }, token ?? undefined));
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
      <PageHeader title="Advance Adjustment Report" subtitle="How much of each advance has been applied against the final bill" />
      <DateRangeBar from={from} to={to} setFrom={setFrom} setTo={setTo} onRefresh={run} loading={loading} />
      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {rows && (
        <ReportPrintShell hotelId={hotelId} title="Advance Adjustment Report">
          <h2 className="mb-3 text-lg font-bold text-slate-900">Advance Adjustment Report</h2>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-brand-600 text-left text-white">
                {['Booking', 'Guest Name', 'Room', 'Advance Received', 'Adjusted Against Stay', 'Balance Due'].map((h) => (
                  <th key={h} className="border border-brand-700 px-3 py-2">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="even:bg-slate-50">
                  <td className="border border-slate-200 px-3 py-1.5">{r.bookingCode}</td>
                  <td className="border border-slate-200 px-3 py-1.5">{r.guestName}</td>
                  <td className="border border-slate-200 px-3 py-1.5">{r.roomNumber}</td>
                  <td className="border border-slate-200 px-3 py-1.5">₹{r.advanceReceived.toFixed(2)}</td>
                  <td className="border border-slate-200 px-3 py-1.5">₹{r.adjustedAgainstStay.toFixed(2)}</td>
                  <td className="border border-slate-200 px-3 py-1.5">₹{r.balanceDue.toFixed(2)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="border border-slate-200 px-3 py-6 text-center text-slate-400">
                    No payments recorded in this range
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </ReportPrintShell>
      )}
    </div>
  );
}

// ──────────────────────────────── Day Book Report ────────────────────────────────

interface DayBookDay {
  date: string;
  credit: number;
  debit: number;
  net: number;
  items: { id: string; description: string; type: 'cash_in' | 'cash_out'; amount: number; method: string }[];
}

export function DayBookReport({ hotelId }: { hotelId: string }) {
  const { token } = useAuth();
  const [from, setFrom] = useState(todayPlus(-6));
  const [to, setTo] = useState(todayPlus(0));
  const [days, setDays] = useState<DayBookDay[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      setDays(await query('reports.dayBook', { hotelId, from, to }, token ?? undefined));
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
      <PageHeader title="Day Book Report" subtitle="One section per day, with its own credit/debit subtotal" />
      <DateRangeBar from={from} to={to} setFrom={setFrom} setTo={setTo} onRefresh={run} loading={loading} />
      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {days && (
        <ReportPrintShell hotelId={hotelId} title="Day Book Report">
          <h2 className="mb-4 text-lg font-bold text-slate-900">Day Book Report</h2>
          {days.length === 0 ? (
            <p className="py-6 text-center text-slate-400">No transactions in this range</p>
          ) : (
            <div className="space-y-5">
              {days.map((d) => (
                <div key={d.date}>
                  <div className="mb-1 flex items-center justify-between bg-brand-600 px-3 py-2 text-xs font-bold text-white">
                    <span>{formatDateShort(d.date)}</span>
                    <span>
                      Credit ₹{d.credit.toFixed(2)} · Debit ₹{d.debit.toFixed(2)} · Net ₹{d.net.toFixed(2)}
                    </span>
                  </div>
                  <table className="w-full border-collapse text-xs">
                    <tbody>
                      {d.items.map((it) => (
                        <tr key={it.id} className="even:bg-slate-50">
                          <td className="border border-slate-200 px-2 py-1.5">{it.description}</td>
                          <td className="border border-slate-200 px-2 py-1.5">{paymentMethodLabel(it.method as PaymentMethod)}</td>
                          <td className={`border border-slate-200 px-2 py-1.5 text-right font-semibold ${it.type === 'cash_in' ? 'text-emerald-600' : 'text-red-600'}`}>
                            {it.type === 'cash_in' ? '+' : '−'}₹{it.amount.toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </ReportPrintShell>
      )}
    </div>
  );
}
