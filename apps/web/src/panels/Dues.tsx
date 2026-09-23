import { useEffect, useState } from 'react';
import { query, ApiError } from '../api';
import { useAuth } from '../AuthContext';
import { Badge, Card, EmptyState, PageHeader, StatCard } from '../components/ui';
import { AddPaymentModal } from './AddPaymentModal';
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

      <Card>
        {rows.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No outstanding dues" hint="Every booking is either paid in full or has nothing collected yet to owe." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-medium text-slate-500">
                  <th className="px-5 py-3">Guest</th>
                  <th className="px-5 py-3">Room</th>
                  <th className="px-5 py-3">Check-in → Check-out</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Paid / Total</th>
                  <th className="px-5 py-3">Due</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const urgent = r.booking.status === 'checked_out';
                  return (
                    <tr key={r.booking.id} className={urgent ? 'bg-red-50/60' : 'hover:bg-slate-50'}>
                      <td className="px-5 py-3 font-medium text-slate-900">{r.booking.guestName}</td>
                      <td className="px-5 py-3 text-slate-500">{r.roomNumber ?? '—'}</td>
                      <td className="px-5 py-3 text-slate-500">
                        {r.booking.checkIn.slice(0, 10)} → {r.booking.checkOut.slice(0, 10)}
                      </td>
                      <td className="px-5 py-3">
                        <Badge tone={r.booking.status}>{urgent ? 'checked out — unpaid' : r.booking.status}</Badge>
                      </td>
                      <td className="px-5 py-3 text-slate-500">
                        ₹{r.booking.paidAmount ?? 0} / ₹{r.grandTotal.toFixed(2)}
                      </td>
                      <td className="px-5 py-3">
                        <span className={`font-semibold ${urgent ? 'text-red-600' : 'text-amber-600'}`}>₹{r.due.toFixed(2)}</span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <button onClick={() => setPayingRow(r)} className="text-xs font-medium text-brand-600 hover:underline">
                          Add payment
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {payingRow && <AddPaymentModal booking={payingRow.booking} onClose={() => setPayingRow(null)} onDone={refresh} />}
    </div>
  );
}
