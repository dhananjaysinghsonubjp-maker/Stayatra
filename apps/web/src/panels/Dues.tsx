import { useEffect, useState } from 'react';
import { query, ApiError } from '../api';
import { useAuth } from '../AuthContext';
import { Badge, Card, EmptyState, PageHeader, StatCard } from '../components/ui';
import { AddPaymentModal } from './AddPaymentModal';
import { formatDateShort } from '../dateFormat';
import type { DueRow } from '../types';

export function Dues({ hotelId }: { hotelId: string }) {
  const { token } = useAuth();
  const [rows, setRows] = useState<DueRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [payingRow, setPayingRow] = useState<DueRow | null>(null);

  async function refresh() {
    try {
      setRows(await query<DueRow[]>('bookings.listDues', { hotelId }, token ?? undefined));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load dues');
    }
  }
  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, 20000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId]);

  const totalDue = rows.reduce((sum, r) => sum + r.due, 0);
  const checkedOutUnpaid = rows.filter((r) => r.booking.status === 'checked_out');
  const inHouseUnpaid = rows.filter((r) => r.booking.status === 'checked_in');
  const upcomingUnpaid = rows.filter((r) => r.booking.status === 'confirmed');

  return (
    <div>
      <PageHeader title="Dues" subtitle="Every booking with money still owed — in-house, checked out, or upcoming" />

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Total outstanding" value={`₹${totalDue.toLocaleString('en-IN')}`} tone="red" />
        <StatCard label="Checked out, unpaid" value={checkedOutUnpaid.length} tone={checkedOutUnpaid.length ? 'red' : 'slate'} />
        <StatCard label="In-house, due" value={inHouseUnpaid.length} tone="amber" />
        <StatCard label="Upcoming, advance due" value={upcomingUnpaid.length} />
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {rows.length === 0 ? (
        <Card>
          <div className="p-6">
            <EmptyState title="No outstanding dues" hint="Every booking is either paid in full or has nothing collected yet to owe." />
          </div>
        </Card>
      ) : (
        // §user request — "text sab hide ho raha hai, properly readable ho": the old table had
        // 7 wide columns (each with px-5 padding) crammed onto one row, forcing the "Check-in →
        // Check-out" header and raw ISO dates ("2026-10-24") to wrap across 3-4 broken lines on a
        // phone. Card list instead — same pattern already used on Reservations for the same
        // reason, so it's also now consistent across the app, not just fixed in one place.
        <div className="space-y-2.5">
          {rows.map((r) => {
            const urgent = r.booking.status === 'checked_out';
            return (
              <Card key={r.booking.id} className={urgent ? 'border-red-200 bg-red-50/40' : ''}>
                <div className="flex items-start justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-slate-900 dark:text-white">{r.booking.guestName}</p>
                    <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                      Room {r.roomNumber ?? '—'} · {formatDateShort(r.booking.checkIn)} – {formatDateShort(r.booking.checkOut)}
                    </p>
                    <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                      Paid ₹{r.booking.paidAmount ?? 0} / ₹{r.grandTotal.toFixed(2)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <Badge tone={r.booking.status}>{urgent ? 'checked out — unpaid' : r.booking.status}</Badge>
                    <span className={`text-sm font-semibold ${urgent ? 'text-red-600' : 'text-amber-600'}`}>₹{r.due.toFixed(2)}</span>
                    <button onClick={() => setPayingRow(r)} className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">
                      Add payment
                    </button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {payingRow && <AddPaymentModal booking={payingRow.booking} onClose={() => setPayingRow(null)} onDone={refresh} />}
    </div>
  );
}
