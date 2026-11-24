import { useEffect, useState } from 'react';
import { query, ApiError } from '../../api';
import { useAuth } from '../../AuthContext';
import { Badge, Button, Card, CardBody, EmptyState, Field, PageHeader, inputClass } from '../../components/ui';
import { SOURCE_LABEL } from '../channel-manager/ota-labels';
import { formatDateShort, formatDateTimeShort } from '../../dateFormat';
import { ReportDateRangePill } from './ReportDateRangePill';
import type { ReservationReportRow } from '../../types';

const STATUS_LABEL: Record<ReservationReportRow['status'], string> = {
  confirmed: 'Reserved',
  checked_in: 'Checked-in',
  checked_out: 'Checked-out',
  cancelled: 'Cancelled',
  no_show: 'No Show',
  void: 'Voided',
};

const STATUS_OPTIONS: ReservationReportRow['status'][] = ['confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show', 'void'];

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

function usePagination<T>(rows: T[], pageSize: number) {
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [rows, pageSize]);
  const start = page * pageSize;
  const pageRows = rows.slice(start, start + pageSize);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  return { page, setPage, pageRows, totalPages, start };
}

function Pagination({ page, setPage, totalPages, start, pageCount, total, pageSize, setPageSize }: {
  page: number;
  setPage: (p: number) => void;
  totalPages: number;
  start: number;
  pageCount: number;
  total: number;
  pageSize: number;
  setPageSize: (n: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-3 text-sm dark:border-slate-700">
      <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
        <span>
          {total === 0 ? '0 to 0' : `${start + 1} to ${start + pageCount}`} of {total}
        </span>
        <select className={`${inputClass} w-auto py-1`} value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
          {[10, 20, 50].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="secondary" className="px-3 py-1.5 text-xs" disabled={page === 0} onClick={() => setPage(page - 1)}>
          ‹ Previous
        </Button>
        <span className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white">{String(page + 1).padStart(2, '0')}</span>
        <Button variant="secondary" className="px-3 py-1.5 text-xs" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>
          Next ›
        </Button>
      </div>
    </div>
  );
}

/**
 * §user request, with a reference app's own "Reservation Master Report" as the target — every
 * booking, every filter at once (search, reservation date, status, check-in/out date, source).
 * The flagship/landing page of the new Reports → Reservation Reports section.
 */
export function ReservationMasterReport({ hotelId }: { hotelId: string }) {
  const { token } = useAuth();
  const [rows, setRows] = useState<ReservationReportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [search, setSearch] = useState('');
  const [reservationFrom, setReservationFrom] = useState('');
  const [reservationTo, setReservationTo] = useState('');
  const [status, setStatus] = useState<ReservationReportRow['status'] | ''>('');
  const [checkInFrom, setCheckInFrom] = useState('');
  const [checkInTo, setCheckInTo] = useState('');
  const [checkOutFrom, setCheckOutFrom] = useState('');
  const [checkOutTo, setCheckOutTo] = useState('');
  const [source, setSource] = useState('');
  const [pageSize, setPageSize] = useState(20);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const result = await query<ReservationReportRow[]>(
        'reports.reservations',
        {
          hotelId,
          statuses: status ? [status] : undefined,
          reservationFrom: reservationFrom || undefined,
          reservationTo: reservationTo || undefined,
          checkInFrom: checkInFrom || undefined,
          checkInTo: checkInTo || undefined,
          checkOutFrom: checkOutFrom || undefined,
          checkOutTo: checkOutTo || undefined,
          search: search || undefined,
          source: source || undefined,
        },
        token ?? undefined,
      );
      setRows(result);
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

  const { page, setPage, pageRows, totalPages, start } = usePagination(rows ?? [], pageSize);

  function exportCsv() {
    if (!rows) return;
    downloadCsv('reservation-master-report.csv', [
      ['Booking Code', 'Reservation Date', 'Guest Name', 'Phone', 'Check-in', 'Check-out', 'Source', 'Room', 'Status', 'Amount'],
      ...rows.map((r) => [
        r.bookingCode,
        formatDateTimeShort(r.reservationDate),
        r.guestName,
        r.guestPhone ?? '',
        formatDateShort(r.checkIn),
        formatDateShort(r.checkOut),
        SOURCE_LABEL[r.source] ?? r.source,
        r.roomNumber ?? '',
        STATUS_LABEL[r.status],
        r.amount,
      ]),
    ]);
  }

  return (
    <div>
      <PageHeader title="Reservation Master Report" subtitle="Every reservation, with every filter at once" />

      <Card className="mb-4">
        <CardBody>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Search Booking Code / Guest">
              <input className={`${inputClass} w-56`} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. BK-A1B2C3 or guest name" />
            </Field>
            <Field label="Reservation Date">
              <ReportDateRangePill from={reservationFrom} to={reservationTo} onChange={(f, t) => { setReservationFrom(f); setReservationTo(t); }} />
            </Field>
            <Field label="Status">
              <select className={`${inputClass} w-40`} value={status} onChange={(e) => setStatus(e.target.value as ReservationReportRow['status'] | '')}>
                <option value="">All Status</option>
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Check-in">
              <ReportDateRangePill from={checkInFrom} to={checkInTo} onChange={(f, t) => { setCheckInFrom(f); setCheckInTo(t); }} />
            </Field>
            <Field label="Check-out">
              <ReportDateRangePill from={checkOutFrom} to={checkOutTo} onChange={(f, t) => { setCheckOutFrom(f); setCheckOutTo(t); }} />
            </Field>
            <Field label="Source">
              <select className={`${inputClass} w-36`} value={source} onChange={(e) => setSource(e.target.value)}>
                <option value="">All Sources</option>
                {Object.entries(SOURCE_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Button onClick={run} disabled={loading}>
              {loading ? 'Searching…' : 'Search'}
            </Button>
            {rows && (
              <Button variant="secondary" onClick={exportCsv}>
                Download CSV
              </Button>
            )}
            {rows && <span className="ml-auto rounded-full bg-brand-50 px-3 py-1.5 text-xs font-bold text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">{rows.length} Found</span>}
          </div>
        </CardBody>
      </Card>

      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <Card className="overflow-hidden">
        {!rows || rows.length === 0 ? (
          <CardBody>
            <EmptyState title={rows ? 'No reservations match these filters' : 'Loading…'} />
          </CardBody>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-brand-50 text-left text-xs font-semibold text-brand-800 dark:bg-brand-500/10 dark:text-brand-300">
                    <th className="px-5 py-3">Booking Code</th>
                    <th className="px-5 py-3">Reservation Date</th>
                    <th className="px-5 py-3">Guest Name</th>
                    <th className="px-5 py-3">Check-in</th>
                    <th className="px-5 py-3">Check-out</th>
                    <th className="px-5 py-3">Source</th>
                    <th className="px-5 py-3">Room</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {pageRows.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                      <td className="px-5 py-3 font-bold text-slate-900 dark:text-white">{r.bookingCode}</td>
                      <td className="px-5 py-3 text-slate-500 dark:text-slate-400">{formatDateTimeShort(r.reservationDate)}</td>
                      <td className="px-5 py-3">
                        <p className="font-medium text-slate-900 dark:text-white">{r.guestName}</p>
                        {r.guestPhone && <p className="text-xs text-slate-400 dark:text-slate-500">{r.guestPhone}</p>}
                      </td>
                      <td className="px-5 py-3 text-slate-600 dark:text-slate-300">{formatDateShort(r.checkIn)}</td>
                      <td className="px-5 py-3 text-slate-600 dark:text-slate-300">{formatDateShort(r.checkOut)}</td>
                      <td className="px-5 py-3 text-slate-500 dark:text-slate-400">{SOURCE_LABEL[r.source] ?? r.source}</td>
                      <td className="px-5 py-3">
                        <p className="font-medium text-slate-900 dark:text-white">{r.roomNumber ?? '—'}</p>
                        {r.roomCategoryName && <p className="text-xs text-slate-400 dark:text-slate-500">{r.roomCategoryName}</p>}
                      </td>
                      <td className="px-5 py-3">
                        <Badge tone={r.status}>{STATUS_LABEL[r.status]}</Badge>
                      </td>
                      <td className="px-5 py-3 text-right font-semibold text-slate-900 dark:text-white">₹{r.amount.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} setPage={setPage} totalPages={totalPages} start={start} pageCount={pageRows.length} total={rows.length} pageSize={pageSize} setPageSize={setPageSize} />
          </>
        )}
      </Card>
    </div>
  );
}

export type StatusReportMode = { kind: 'status'; statuses: ReservationReportRow['status'][] } | { kind: 'checkIn' } | { kind: 'checkOut' };

/**
 * Shared by Completed/Cancelled/No-Show/Arrivals/Departures — a reference app's own narrower
 * report views, each the Master Report's same data pre-filtered to one status or date field,
 * with a lighter 4-column table instead of the Master Report's full grid.
 */
export function ReservationStatusReport({ hotelId, title, subtitle, mode }: { hotelId: string; title: string; subtitle: string; mode: StatusReportMode }) {
  const { token } = useAuth();
  const todayIso = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(mode.kind === 'status' ? new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10) : todayIso);
  const [to, setTo] = useState(todayIso);
  const [rows, setRows] = useState<ReservationReportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pageSize, setPageSize] = useState(10);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, unknown> = { hotelId };
      if (mode.kind === 'status') {
        params.statuses = mode.statuses;
        params.reservationFrom = from;
        params.reservationTo = to;
      } else if (mode.kind === 'checkIn') {
        params.checkInFrom = from;
        params.checkInTo = to;
        params.statuses = ['confirmed', 'checked_in', 'checked_out'];
      } else {
        params.checkOutFrom = from;
        params.checkOutTo = to;
        params.statuses = ['confirmed', 'checked_in', 'checked_out'];
      }
      setRows(await query<ReservationReportRow[]>('reports.reservations', params, token ?? undefined));
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

  const { page, setPage, pageRows, totalPages, start } = usePagination(rows ?? [], pageSize);

  function exportCsv() {
    if (!rows) return;
    downloadCsv(`${title.toLowerCase().replace(/\s+/g, '-')}.csv`, [
      ['Booking Code', 'Reservation Date', 'Guest Name', 'Phone', 'Check-in', 'Check-out', 'Amount'],
      ...rows.map((r) => [r.bookingCode, formatDateTimeShort(r.reservationDate), r.guestName, r.guestPhone ?? '', formatDateShort(r.checkIn), formatDateShort(r.checkOut), r.amount]),
    ]);
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white">
            {title}
            {rows && <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-bold text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">{rows.length} Found</span>}
            {rows && rows.length > 0 && (
              <button onClick={exportCsv} title="Download CSV" className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-400 dark:hover:bg-slate-700">
                ↓
              </button>
            )}
          </h2>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={run} disabled={loading} title="Refresh" className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-brand-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-brand-400 dark:hover:bg-slate-700">
            ⟳
          </button>
          <ReportDateRangePill from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
          <Button onClick={run} disabled={loading}>
            {loading ? '…' : 'Go'}
          </Button>
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <Card className="overflow-hidden">
        {!rows || rows.length === 0 ? (
          <CardBody>
            <EmptyState title={rows ? 'No report records found' : 'Loading…'} />
          </CardBody>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-brand-50 text-left text-xs font-semibold text-brand-800 dark:bg-brand-500/10 dark:text-brand-300">
                    <th className="px-5 py-3">Booking Details</th>
                    <th className="px-5 py-3">Guest</th>
                    <th className="px-5 py-3">Check In / Check Out Date</th>
                    <th className="px-5 py-3 text-right">Financial</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {pageRows.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                      <td className="px-5 py-3">
                        <p className="font-bold text-slate-900 dark:text-white">{r.bookingCode}</p>
                        <p className="text-xs text-slate-400 dark:text-slate-500">{formatDateTimeShort(r.reservationDate)}</p>
                      </td>
                      <td className="px-5 py-3">
                        <p className="font-medium text-slate-900 dark:text-white">{r.guestName}</p>
                        {r.guestPhone && <p className="text-xs text-slate-400 dark:text-slate-500">{r.guestPhone}</p>}
                      </td>
                      <td className="px-5 py-3 text-slate-600 dark:text-slate-300">
                        {formatDateShort(r.checkIn)} – {formatDateShort(r.checkOut)}
                      </td>
                      <td className="px-5 py-3 text-right font-semibold text-slate-900 dark:text-white">₹{r.amount.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} setPage={setPage} totalPages={totalPages} start={start} pageCount={pageRows.length} total={rows.length} pageSize={pageSize} setPageSize={setPageSize} />
          </>
        )}
      </Card>
    </div>
  );
}

export function CompletedReservationsReport({ hotelId }: { hotelId: string }) {
  return <ReservationStatusReport hotelId={hotelId} title="Completed Reservation" subtitle="View details of completed reservations" mode={{ kind: 'status', statuses: ['checked_out'] }} />;
}

export function CancelledReservationsReport({ hotelId }: { hotelId: string }) {
  return <ReservationStatusReport hotelId={hotelId} title="Cancelled Reservation" subtitle="View details of cancelled reservations" mode={{ kind: 'status', statuses: ['cancelled'] }} />;
}

export function NoShowReservationsReport({ hotelId }: { hotelId: string }) {
  return <ReservationStatusReport hotelId={hotelId} title="No-Show Reservation" subtitle="Reservations where the guest never arrived" mode={{ kind: 'status', statuses: ['no_show'] }} />;
}

export function ArrivalsReport({ hotelId }: { hotelId: string }) {
  return <ReservationStatusReport hotelId={hotelId} title="Arrivals" subtitle="Guests arriving in the selected date range" mode={{ kind: 'checkIn' }} />;
}

export function DeparturesReport({ hotelId }: { hotelId: string }) {
  return <ReservationStatusReport hotelId={hotelId} title="Departures" subtitle="Guests departing in the selected date range" mode={{ kind: 'checkOut' }} />;
}
