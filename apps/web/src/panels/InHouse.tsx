import { useEffect, useState } from 'react';
import { mutate, query, ApiError } from '../api';
import { useAuth } from '../AuthContext';
import { Badge, Card, EmptyState, PageHeader } from '../components/ui';
import { computeInvoiceTotals } from '../invoice';
import { formatDateShort } from '../dateFormat';
import { EditBookingModal } from './EditBookingModal';
import type { InHouseRow } from '../types';

export function InHouse({ hotelId }: { hotelId: string }) {
  const { token, role } = useAuth();
  const [rows, setRows] = useState<InHouseRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editingBookingId, setEditingBookingId] = useState<string | null>(null);
  const canResolve = ['owner', 'manager'].includes(role('pms') ?? '');
  const canManage = ['owner', 'manager', 'front_desk'].includes(role('pms') ?? '');

  async function refresh() {
    try {
      setRows(await query<InHouseRow[]>('bookings.listInHouse', { hotelId }, token ?? undefined));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load in-house guests');
    }
  }
  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, 15000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId]);

  async function resolveDelay(bookingId: string) {
    const note = prompt('Note for resolving this delay?');
    if (!note) return;
    await mutate('bookings.resolveDelay', { bookingId, note }, token ?? undefined);
    await refresh();
  }

  const [checkingOutId, setCheckingOutId] = useState<string | null>(null);
  async function checkOutGuest(bookingId: string, guestName: string, roomNumber: string) {
    if (!confirm(`Check out ${guestName} from Room ${roomNumber}? The room will move to Housekeeping until it's cleaned.`)) return;
    setCheckingOutId(bookingId);
    try {
      await mutate('bookings.checkOutGuest', { hotelId, bookingId }, token ?? undefined);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Check-out failed');
    } finally {
      setCheckingOutId(null);
    }
  }

  const delayedCount = rows.filter((r) => r.delayed).length;

  return (
    <div>
      <PageHeader
        title="In-House Guests"
        subtitle={`${rows.length} currently staying${delayedCount ? ` · ${delayedCount} past cleaning deadline` : ''}`}
      />
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No guests currently in-house" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-brand-600 text-left text-xs font-semibold text-white">
                  <th className="px-5 py-3">Room</th>
                  <th className="px-5 py-3">Guest</th>
                  <th className="px-5 py-3">Check In</th>
                  <th className="px-5 py-3">Check Out</th>
                  <th className="px-5 py-3">Balance</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const totals = computeInvoiceTotals({
                    totalAmount: Number(r.booking.totalAmount),
                    lineItems: r.booking.lineItems ?? [],
                    discountAmount: r.booking.discountAmount ? Number(r.booking.discountAmount) : null,
                    gstExempt: r.booking.gstExempt,
                  });
                  const due = totals.grandTotal - Number(r.booking.paidAmount ?? 0);
                  const rowBg = r.delayed ? 'bg-red-50/60 dark:bg-red-900/20' : i % 2 === 0 ? 'bg-white dark:bg-slate-800' : 'bg-slate-50 dark:bg-slate-800/60';
                  return (
                    <tr
                      key={r.booking.id}
                      className={`border-b border-slate-100 last:border-0 dark:border-slate-700 ${rowBg} hover:bg-brand-50/40 dark:hover:bg-brand-500/10`}
                    >
                      <td className="px-5 py-3 font-medium text-slate-900 dark:text-white">{r.room.roomNumber}</td>
                      <td className="px-5 py-3 font-medium text-slate-900 dark:text-white">{r.booking.guestName}</td>
                      <td className="px-5 py-3 font-medium text-slate-900 dark:text-white">{formatDateShort(r.booking.checkIn)}</td>
                      <td className="px-5 py-3 font-medium text-slate-900 dark:text-white">{formatDateShort(r.booking.checkOut)}</td>
                      <td className="px-5 py-3">
                        {due > 0 ? <span className="text-amber-600">₹{due} due</span> : <span className="text-emerald-600">paid in full</span>}
                      </td>
                      <td className="px-5 py-3">
                        {r.delayed ? (
                          <Badge tone="flagged">delayed — past checkout</Badge>
                        ) : (
                          <Badge tone="occupied">in-house</Badge>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex justify-end gap-3">
                          {canManage && (
                            <button onClick={() => setEditingBookingId(r.booking.id)} className="text-xs font-medium text-brand-600 hover:underline">
                              Manage
                            </button>
                          )}
                          {canManage && (
                            <button
                              onClick={() => checkOutGuest(r.booking.id, r.booking.guestName, r.room.roomNumber)}
                              disabled={checkingOutId === r.booking.id}
                              className="text-xs font-medium text-amber-600 hover:underline disabled:opacity-50"
                            >
                              {checkingOutId === r.booking.id ? 'Checking out…' : 'Check-out Guest'}
                            </button>
                          )}
                          {r.delayed && canResolve && (
                            <button onClick={() => resolveDelay(r.booking.id)} className="text-xs font-medium text-brand-600 hover:underline">
                              Resolve
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editingBookingId && (
        <EditBookingModal
          hotelId={hotelId}
          bookingId={editingBookingId}
          onClose={() => setEditingBookingId(null)}
          onDone={refresh}
        />
      )}
    </div>
  );
}
