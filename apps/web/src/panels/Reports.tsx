import { Fragment, useEffect, useState } from 'react';
import { query, ApiError } from '../api';
import { useAuth } from '../AuthContext';
import { Button, Card, CardBody, CardHeader, EmptyState, Field, PageHeader, inputClass } from '../components/ui';
import { PAYMENT_METHODS, paymentMethodLabel } from '../paymentMethods';
import { istDateKey, istDateLabel } from '../components/DateRangePicker';
import { formatDateShort, formatDateTimeShort } from '../dateFormat';
import { ReportPrintShell } from './reports/ReportPrintShell';
import { DateRangeBar } from './reports/DocumentReports';
import type { LedgerTransaction, MethodBreakdown, RoomsReport, SaleReportDay } from '../types';

function todayPlus(days: number) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

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

function methodsTotal(m: MethodBreakdown): number {
  return Object.values(m).reduce((sum: number, v) => sum + (v ?? 0), 0);
}

function MethodsCell({ methods }: { methods: MethodBreakdown }) {
  const entries = Object.entries(methods).filter(([, v]) => (v ?? 0) > 0) as [keyof MethodBreakdown, number][];
  if (entries.length === 0) return <span className="text-slate-300">—</span>;
  return (
    <span className="text-slate-600">
      {entries.map(([method, amount], i) => (
        <span key={method}>
          {i > 0 && ', '}
          {paymentMethodLabel(method)} ₹{amount}
        </span>
      ))}
    </span>
  );
}

/** §user request — "Dues section ko Reports section ke under le jayenge": Rooms/Sale/Expenses
 * moved from this page's own in-page tab switcher to three separate Reports → Finance & Payment
 * sidebar leaves, each passing its own `only` so this renders just that one view instead of all
 * three behind a switcher nobody can see from the sidebar anymore. */
export function Reports({ hotelId, only }: { hotelId: string; only: 'rooms' | 'sale' | 'expenses' }) {
  const TITLE = { rooms: 'Rooms Report', sale: 'Sale Report', expenses: 'Daily Expenses' }[only];
  const SUBTITLE = {
    rooms: 'Check-ins, cleanings, checkouts, delays and collections by day',
    sale: 'Revenue counted on check-in day, by day',
    expenses: 'Cash Out entries from the Ledger, grouped by day',
  }[only];

  return (
    <div>
      <PageHeader title={TITLE} subtitle={SUBTITLE} />
      {only === 'rooms' ? <RoomsReportView hotelId={hotelId} /> : only === 'sale' ? <SaleReportView hotelId={hotelId} /> : <ExpensesReportView hotelId={hotelId} />}
    </div>
  );
}

function ExpensesReportView({ hotelId }: { hotelId: string }) {
  const { token } = useAuth();
  const [from, setFrom] = useState(todayPlus(-30));
  const [to, setTo] = useState(todayPlus(0));
  const [transactions, setTransactions] = useState<LedgerTransaction[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const rows = await query<LedgerTransaction[]>(
        'ledger.listTransactions',
        { hotelId, from: `${from}T00:00:00`, to: `${to}T23:59:59` },
        token ?? undefined,
      );
      setTransactions(rows.filter((t) => t.type === 'cash_out'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load expenses');
    } finally {
      setLoading(false);
    }
  }

  // Grouped oldest-day-first — a Day Book reads top-to-bottom as the days actually happened,
  // each one its own dated section with its own items and its own subtotal.
  const byDay = (() => {
    if (!transactions) return [];
    const groups = new Map<string, LedgerTransaction[]>();
    for (const t of transactions) {
      const key = istDateKey(t.createdAt);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(t);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, items]) => ({
        date,
        items: items.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
        total: items.reduce((sum, t) => sum + t.amount, 0),
      }));
  })();
  const grandTotal = byDay.reduce((sum, d) => sum + d.total, 0);

  function exportCsv() {
    if (!transactions) return;
    const rows: (string | number)[][] = [
      ['Date', 'Time', 'Item / Expense', 'Category', 'Method', 'Amount'],
      ...byDay.flatMap((d) =>
        d.items.map((t) => [
          istDateLabel(d.date),
          formatDateTimeShort(t.createdAt).split(', ')[1] ?? '',
          t.remarks || t.category || 'Expense',
          t.category ?? '—',
          paymentMethodLabel(t.paymentMethod),
          t.amount,
        ]),
      ),
    ];
    downloadCsv(`daily-expenses-${from}-to-${to}.csv`, rows);
  }

  return (
    <div>
      <Card className="mb-6">
        <CardBody>
          <div className="flex flex-wrap items-end gap-4">
            <Field label="From">
              <input className={inputClass} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="To">
              <input className={inputClass} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
            <Button onClick={run} disabled={loading}>
              {loading ? 'Loading…' : 'Run report'}
            </Button>
            {transactions && transactions.length > 0 && (
              <Button variant="secondary" onClick={exportCsv}>
                Download CSV
              </Button>
            )}
          </div>
        </CardBody>
      </Card>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {transactions && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <SummaryTile label="Total Expenses" value={`₹${grandTotal.toLocaleString('en-IN')}`} tone="red" />
            <SummaryTile label="Days with expenses" value={byDay.length} />
          </div>

          {byDay.length === 0 ? (
            <Card>
              <CardBody>
                <EmptyState title="No expenses in this range" hint="Log one from the Ledger page — it'll show up here, grouped by day." />
              </CardBody>
            </Card>
          ) : (
            <div className="space-y-4">
              {byDay.map((d) => (
                <Card key={d.date}>
                  <CardHeader title={istDateLabel(d.date)} action={<span className="text-sm font-semibold text-red-600">₹{d.total.toLocaleString('en-IN')}</span>} />
                  <div className="divide-y divide-slate-100">
                    {d.items.map((t) => (
                      <div key={t.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                        <div className="min-w-0">
                          <p className="font-medium text-slate-900">{t.remarks || t.category || 'Expense'}</p>
                          <p className="text-xs text-slate-400">
                            {formatDateTimeShort(t.createdAt).split(', ')[1]}
                            {t.category ? ` · ${t.category}` : ''} · {paymentMethodLabel(t.paymentMethod)}
                          </p>
                        </div>
                        <span className="shrink-0 font-semibold text-red-600">−₹{t.amount.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * §user request — "isko bhi proper PDF mein banao jaise sabme banaya hai, aur clean/simple banao
 * taaki dekhne wale ko easily samajh mein aaye": the old 3-table layout (daily counts, per-room
 * counts, then the stay log) buried the one table that actually answers "which room, which guest,
 * who cleaned it" under two aggregate tables repeating the same numbers in a less readable shape —
 * this now matches the other PDF reports (ReportPrintShell + a date range bar) with a single
 * summary strip and the stay log as the one table.
 */
function RoomsReportView({ hotelId }: { hotelId: string }) {
  const { token } = useAuth();
  const [from, setFrom] = useState(todayPlus(-7));
  const [to, setTo] = useState(todayPlus(0));
  const [report, setReport] = useState<RoomsReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      setReport(await query<RoomsReport>('reports.rooms', { hotelId, from, to }, token ?? undefined));
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

  const totals = report?.days.reduce(
    (acc, d) => ({
      checkIns: acc.checkIns + d.checkIns,
      cleanings: acc.cleanings + d.cleanings,
      discrepancies: acc.discrepancies + d.discrepancies,
      collected: acc.collected + methodsTotal(d.methods),
    }),
    { checkIns: 0, cleanings: 0, discrepancies: 0, collected: 0 },
  );

  return (
    <div>
      <PageHeader title="Rooms Report" subtitle="Every stay in the range, who cleaned it, and how it was checked out" />
      <DateRangeBar from={from} to={to} setFrom={setFrom} setTo={setTo} onRefresh={run} loading={loading} />
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {report && totals && (
        <ReportPrintShell hotelId={hotelId} title="Rooms Report">
          <div className="mb-4 flex items-start justify-between">
            <h2 className="text-lg font-bold text-slate-900">Rooms Report</h2>
            <p className="text-xs text-slate-500">
              {formatDateShort(from)} to {formatDateShort(to)}
            </p>
          </div>
          <div className="mb-5 grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 text-center text-xs sm:grid-cols-4">
            <div>
              <p className="text-slate-500">Check-ins</p>
              <p className="font-bold text-slate-900">{totals.checkIns}</p>
            </div>
            <div>
              <p className="text-slate-500">Cleanings</p>
              <p className="font-bold text-slate-900">{totals.cleanings}</p>
            </div>
            <div>
              <p className="text-slate-500">Discrepancies</p>
              <p className={`font-bold ${totals.discrepancies > 0 ? 'text-red-600' : 'text-slate-900'}`}>{totals.discrepancies}</p>
            </div>
            <div>
              <p className="text-slate-500">Collected</p>
              <p className="font-bold text-slate-900">₹{totals.collected.toLocaleString('en-IN')}</p>
            </div>
          </div>

          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-brand-600 text-left text-white">
                {['Room', 'Guest', 'Check-in', 'Check-out', 'Cleaned By', 'Cleaned At', 'Checked Out Via'].map((h) => (
                  <th key={h} className="border border-brand-700 px-3 py-2 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.stayLog.map((r) => (
                <tr key={r.id} className="even:bg-slate-50">
                  <td className="border border-slate-200 px-3 py-1.5 font-medium text-slate-900">{r.roomNumber}</td>
                  <td className="border border-slate-200 px-3 py-1.5">{r.guestName}</td>
                  <td className="border border-slate-200 px-3 py-1.5 whitespace-nowrap">{r.checkInAt ? formatDateTimeShort(r.checkInAt) : '—'}</td>
                  <td className="border border-slate-200 px-3 py-1.5 whitespace-nowrap">{r.checkOutAt ? formatDateTimeShort(r.checkOutAt) : '—'}</td>
                  <td className="border border-slate-200 px-3 py-1.5">{r.cleanedBy ?? '—'}</td>
                  <td className="border border-slate-200 px-3 py-1.5 whitespace-nowrap">{r.cleanedAt ? formatDateTimeShort(r.cleanedAt) : '—'}</td>
                  <td className="border border-slate-200 px-3 py-1.5">
                    {r.checkedOutVia === 'fmo'
                      ? `FMO Dashboard${r.checkedOutByName ? ` · ${r.checkedOutByName}` : ''}`
                      : r.checkedOutVia === 'housekeeping'
                        ? 'Housekeeping'
                        : 'Not checked out yet'}
                  </td>
                </tr>
              ))}
              {report.stayLog.length === 0 && (
                <tr>
                  <td colSpan={7} className="border border-slate-200 px-3 py-6 text-center text-slate-400">
                    No completed stays in this range
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

function SaleReportView({ hotelId }: { hotelId: string }) {
  const { token } = useAuth();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [report, setReport] = useState<SaleReportDay[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      setReport(await query<SaleReportDay[]>('reports.sale', { hotelId, month }, token ?? undefined));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load report');
    } finally {
      setLoading(false);
    }
  }

  function exportCsv() {
    if (!report) return;
    const methodCols = PAYMENT_METHODS.map((m) => m.label);
    const rows: (string | number)[][] = [
      ['Date', ...methodCols, 'Due', 'Total sale'],
      ...report.map((d) => [d.date, ...PAYMENT_METHODS.map((m) => d.methods[m.value] ?? 0), d.due, d.totalSale]),
    ];
    downloadCsv(`sale-report-${month}.csv`, rows);
  }

  const monthTotal = report?.reduce((sum, d) => sum + d.totalSale, 0) ?? 0;
  // §user request — "poora sale report share karo: Total Sale, Through Cash, Through Online,
  // Through NEFT": summed straight from each day's own method breakdown, already fetched.
  const cashTotal = report?.reduce((sum, d) => sum + (d.methods.cash ?? 0), 0) ?? 0;
  const onlineTotal = report?.reduce((sum, d) => sum + (d.methods.online ?? 0), 0) ?? 0;
  const neftTotal = report?.reduce((sum, d) => sum + (d.methods.bank_transfer ?? 0), 0) ?? 0;

  return (
    <div>
      <Card className="mb-6">
        <CardBody>
          <div className="flex flex-wrap items-end gap-4">
            <Field label="Month">
              <input className={inputClass} type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            </Field>
            <Button onClick={run} disabled={loading}>
              {loading ? 'Loading…' : 'Run report'}
            </Button>
            {report && (
              <Button variant="secondary" onClick={exportCsv}>
                Download CSV
              </Button>
            )}
          </div>
        </CardBody>
      </Card>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {report && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <SummaryTile label="Total Sale" value={`₹${monthTotal.toLocaleString('en-IN')}`} />
            <SummaryTile label="Through Cash" value={`₹${cashTotal.toLocaleString('en-IN')}`} />
            <SummaryTile label="Through Online" value={`₹${onlineTotal.toLocaleString('en-IN')}`} />
            <SummaryTile label="Through NEFT" value={`₹${neftTotal.toLocaleString('en-IN')}`} />
          </div>

          <Card>
            <CardHeader title="Daily ledger" subtitle="Revenue counted on check-in day, never per night." />
            {report.length === 0 ? (
              <CardBody>
                <EmptyState title="No bookings checked in this month" />
              </CardBody>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-xs font-medium text-slate-500">
                      <th className="px-5 py-3">Date</th>
                      <th className="px-5 py-3">Collections</th>
                      <th className="px-5 py-3">Due</th>
                      <th className="px-5 py-3">Total sale</th>
                      <th className="px-5 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {report.map((d) => (
                      <Fragment key={d.date}>
                        <tr className="hover:bg-slate-50">
                          <td className="px-5 py-3 font-medium text-slate-900">{d.date}</td>
                          <td className="px-5 py-3">
                            <MethodsCell methods={d.methods} />
                          </td>
                          <td className="px-5 py-3">{d.due > 0 ? <span className="text-amber-600">₹{d.due}</span> : '—'}</td>
                          <td className="px-5 py-3 font-medium">₹{d.totalSale}</td>
                          <td className="px-5 py-3 text-right">
                            <button
                              onClick={() => setExpanded(expanded === d.date ? null : d.date)}
                              className="text-xs font-medium text-brand-600 hover:underline"
                            >
                              {expanded === d.date ? 'Hide' : `${d.bookings.length} booking${d.bookings.length === 1 ? '' : 's'}`}
                            </button>
                          </td>
                        </tr>
                        {expanded === d.date && (
                          <tr>
                            <td colSpan={5} className="bg-slate-50 px-5 py-3">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-left text-slate-500">
                                    <th className="py-1 pr-4">Guest</th>
                                    <th className="py-1 pr-4">Room</th>
                                    <th className="py-1 pr-4">Total</th>
                                    <th className="py-1 pr-4">Paid</th>
                                    <th className="py-1">Due</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {d.bookings.map((b) => (
                                    <tr key={b.id}>
                                      <td className="py-1 pr-4">{b.guestName}</td>
                                      <td className="py-1 pr-4">{b.roomNumber ?? '—'}</td>
                                      <td className="py-1 pr-4">₹{b.grandTotal}</td>
                                      <td className="py-1 pr-4">₹{b.paidAmount}</td>
                                      <td className="py-1">₹{b.due}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </Fragment>
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

function SummaryTile({ label, value, tone }: { label: string; value: string | number; tone?: 'red' }) {
  return (
    <Card className="px-5 py-4">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-1.5 text-2xl font-semibold tabular-nums ${tone === 'red' ? 'text-red-600' : 'text-slate-900'}`}>{value}</p>
    </Card>
  );
}
