import { Card } from '../../components/ui';
import { ChannelBadge } from './ChannelBadge';
import { payableToProperty } from './cmStats';
import type { Booking, OtaConnection } from '../../types';

/** The reference product's recent-bookings table — OTA badge per row, cancelled rows struck through, "payable to property" net of commission. */
export function BookingsTable({ bookings, connections }: { bookings: Booking[]; connections: OtaConnection[] }) {
  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs font-medium text-slate-500">
              <th className="px-5 py-3">Booking ID</th>
              <th className="px-5 py-3">Customer</th>
              <th className="px-5 py-3">Check-in</th>
              <th className="px-5 py-3">Check-out</th>
              <th className="px-5 py-3">Total Amt</th>
              <th className="px-5 py-3">Payable to Property</th>
              <th className="px-5 py-3">Channel</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {bookings.map((b) => {
              const cancelled = b.status === 'cancelled';
              const payable = payableToProperty(b, connections);
              const rowClass = cancelled ? 'text-red-400 line-through' : 'text-slate-700';
              return (
                <tr key={b.id}>
                  <td className={`px-5 py-3 font-mono text-xs ${rowClass}`}>{b.id.slice(0, 10)}</td>
                  <td className={`px-5 py-3 ${rowClass}`}>{b.guestName}</td>
                  <td className={`px-5 py-3 ${rowClass}`}>{b.checkIn.slice(0, 10)}</td>
                  <td className={`px-5 py-3 ${rowClass}`}>{b.checkOut.slice(0, 10)}</td>
                  <td className={`px-5 py-3 ${cancelled ? rowClass : 'font-medium text-slate-900'}`}>₹{Number(b.totalAmount).toFixed(2)}</td>
                  <td className={`px-5 py-3 ${rowClass}`}>{payable != null ? `₹${payable.toFixed(2)}` : '—'}</td>
                  <td className={`px-5 py-3 ${rowClass}`}>
                    <ChannelBadge source={b.source} />
                  </td>
                </tr>
              );
            })}
            {bookings.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-6 text-center text-sm text-slate-400">
                  No bookings in this range.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
