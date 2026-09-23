import { Fragment, useState } from 'react';
import { query, ApiError } from '../api';
import { useAuth } from '../AuthContext';
import { Button, Card, CardBody, CardHeader, EmptyState, Field, PageHeader, inputClass } from '../components/ui';
import type { RoomsReport, SaleReportDay } from '../types';

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

export function Reports({ hotelId }: { hotelId: string }) {
  const [tab, setTab] = useState<'rooms' | 'sale'>('rooms');

  return (
    <div>
      <PageHeader title="Reports" subtitle="§8.8 — Rooms Report and Sale Report" />
      <div className="mb-6 flex gap-2">
        <Button variant={tab === 'rooms' ? 'primary' : 'secondary'} onClick={() => setTab('rooms')}>
          Rooms Report
        </Button>
        <Button variant={tab === 'sale' ? 'primary' : 'secondary'} onClick={() => setTab('sale')}>
          Sale Report
        </Button>
      </div>
      {tab === 'rooms' ? <RoomsReportView hotelId={hotelId} /> : <SaleReportView hotelId={hotelId} />}
    </div>
  );
}

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

  function exportCsv() {
    if (!report) return;
    const rows: (string | number)[][] = [
      ['Date', 'Check-ins', 'Cleanings', 'Guest cleanings', 'Checkouts', 'Discrepancies', 'Delays resolved', 'Cash', 'Online', 'Card'],
      ...report.days.map((d) => [d.date, d.checkIns, d.cleanings, d.guestCleanings, d.checkouts, d.discrepancies, d.delaysResolved, d.cash, d.online, d.card]),
    ];
    downloadCsv(`rooms-report-${from}-to-${to}.csv`, rows);
  }

  const totals = report?.days.reduce(
    (acc, d) => ({
      checkIns: acc.checkIns + d.checkIns,
      cleanings: acc.cleanings + d.cleanings,
      discrepancies: acc.discrepancies + d.discrepancies,
      collected: acc.collected + d.cash + d.online + d.card,
    }),
    { checkIns: 0, cleanings: 0, discrepancies: 0, collected: 0 },
  );

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
            {report && (
              <Button variant="secondary" onClick={exportCsv}>
                Download CSV
              </Button>
            )}
          </div>
        </CardBody>
      </Card>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {report && totals && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <SummaryTile label="Check-ins" value={totals.checkIns} />
            <SummaryTile label="Cleanings" value={totals.cleanings} />
            <SummaryTile label="Discrepancies" value={totals.discrepancies} tone={totals.discrepancies > 0 ? 'red' : undefined} />
            <SummaryTile label="Collected" value={`₹${totals.collected.toLocaleString('en-IN')}`} />
          </div>

          <Card className="mb-6">
            <CardHeader title="Daily breakdown" />
            {report.days.length === 0 ? (
              <CardBody>
                <EmptyState title="No activity in this range" />
              </CardBody>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-xs font-medium text-slate-500">
                      <th className="px-5 py-3">Date</th>
                      <th className="px-5 py-3">Check-ins</th>
                      <th className="px-5 py-3">Cleanings</th>
                      <th className="px-5 py-3">Guest cleanings</th>
                      <th className="px-5 py-3">Checkouts</th>
                      <th className="px-5 py-3">Discrepancies</th>
                      <th className="px-5 py-3">Delays resolved</th>
                      <th className="px-5 py-3">Cash</th>
                      <th className="px-5 py-3">Online</th>
                      <th className="px-5 py-3">Card</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {report.days.map((d) => (
                      <tr key={d.date} className="hover:bg-slate-50">
                        <td className="px-5 py-3 font-medium text-slate-900">{d.date}</td>
                        <td className="px-5 py-3">{d.checkIns}</td>
                        <td className="px-5 py-3">{d.cleanings}</td>
                        <td className="px-5 py-3">{d.guestCleanings}</td>
                        <td className="px-5 py-3">{d.checkouts}</td>
                        <td className="px-5 py-3">{d.discrepancies > 0 ? <span className="font-medium text-red-600">{d.discrepancies}</span> : 0}</td>
                        <td className="px-5 py-3">{d.delaysResolved}</td>
                        <td className="px-5 py-3">₹{d.cash}</td>
                        <td className="px-5 py-3">₹{d.online}</td>
                        <td className="px-5 py-3">₹{d.card}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Per-room breakdown" />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs font-medium text-slate-500">
                    <th className="px-5 py-3">Room</th>
                    <th className="px-5 py-3">Check-ins</th>
                    <th className="px-5 py-3">Cleanings</th>
                    <th className="px-5 py-3">Discrepancies</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {report.rooms.map((r) => (
                    <tr key={r.roomId} className="hover:bg-slate-50">
                      <td className="px-5 py-3 font-medium text-slate-900">{r.roomNumber}</td>
                      <td className="px-5 py-3">{r.checkIns}</td>
                      <td className="px-5 py-3">{r.cleanings}</td>
                      <td className="px-5 py-3">{r.discrepancies > 0 ? <span className="font-medium text-red-600">{r.discrepancies}</span> : 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
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
    const rows: (string | number)[][] = [
      ['Date', 'Cash', 'Online', 'Card', 'Due', 'Total sale'],
      ...report.map((d) => [d.date, d.cash, d.online, d.card, d.due, d.totalSale]),
    ];
    downloadCsv(`sale-report-${month}.csv`, rows);
  }

  const monthTotal = report?.reduce((sum, d) => sum + d.totalSale, 0) ?? 0;

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
          <div className="mb-6">
            <SummaryTile label="Month total sale" value={`₹${monthTotal.toLocaleString('en-IN')}`} />
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
                      <th className="px-5 py-3">Cash</th>
                      <th className="px-5 py-3">Online</th>
                      <th className="px-5 py-3">Card</th>
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
                          <td className="px-5 py-3">₹{d.cash}</td>
                          <td className="px-5 py-3">₹{d.online}</td>
                          <td className="px-5 py-3">₹{d.card}</td>
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
                            <td colSpan={7} className="bg-slate-50 px-5 py-3">
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
                                      <td className="py-1 pr-4">₹{b.totalAmount}</td>
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
