import { useState } from 'react';
import { Card } from '../../components/ui';
import { ChannelBadge } from './ChannelBadge';
import { BookingViewModal } from '../BookingViewModal';
import { formatDateShort } from '../../dateFormat';
import type { Booking, RoomCategory } from '../../types';

/** The reference product's recent-bookings table (§ user request — clean, simple, readable: Booking
 * ID / Guest Name / Check In / Check Out / Room Type / Total Amt / OTA Platform, header in this
 * app's own brand blue with white labels in the same font weight used everywhere else in Channel
 * Manager, alternating white/grey rows, a "Details" link opening the full read-only breakdown.
 * `overflow-hidden` on the Card keeps the colored header's corners clipped to the card's own
 * rounded corners instead of poking past them. */
export function BookingsTable({ bookings, categories }: { bookings: Booking[]; categories: RoomCategory[] }) {
  const [viewing, setViewing] = useState<Booking | null>(null);

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-brand-600 text-left text-xs font-semibold text-white">
              <th className="px-5 py-3">Booking ID</th>
              <th className="px-5 py-3">Guest Name</th>
              <th className="px-5 py-3">Check In</th>
              <th className="px-5 py-3">Check Out</th>
              <th className="px-5 py-3">Room Type</th>
              <th className="px-5 py-3">Total Amt</th>
              <th className="px-5 py-3">OTA Platform</th>
              <th className="px-5 py-3 text-right">View</th>
            </tr>
          </thead>
          <tbody>
            {bookings.map((b, i) => {
              const cancelled = b.status === 'cancelled';
              const roomType = categories.find((c) => c.id === b.roomCategoryId)?.name ?? '—';
              const rowBg = i % 2 === 0 ? 'bg-white dark:bg-slate-800' : 'bg-slate-50 dark:bg-slate-800/60';
              const textTone = cancelled ? 'text-red-400 line-through dark:text-red-500/70' : 'text-slate-700 dark:text-slate-300';
              return (
                <tr key={b.id} className={`${rowBg} border-b border-slate-100 last:border-0 dark:border-slate-700`}>
                  <td className={`px-5 py-3.5 font-mono text-xs ${textTone}`}>{b.id.slice(0, 10)}</td>
                  <td className={`px-5 py-3.5 font-medium ${cancelled ? textTone : 'text-slate-900 dark:text-white'}`}>{b.guestName}</td>
                  <td className={`px-5 py-3.5 font-medium ${cancelled ? textTone : 'text-slate-900 dark:text-white'}`}>{formatDateShort(b.checkIn)}</td>
                  <td className={`px-5 py-3.5 font-medium ${cancelled ? textTone : 'text-slate-900 dark:text-white'}`}>{formatDateShort(b.checkOut)}</td>
                  <td className={`px-5 py-3.5 ${textTone}`}>{roomType}</td>
                  <td className={`px-5 py-3.5 ${cancelled ? textTone : 'font-semibold text-slate-900 dark:text-white'}`}>₹{Number(b.totalAmount).toFixed(2)}</td>
                  <td className={`px-5 py-3.5 ${textTone}`}>
                    <ChannelBadge source={b.source} />
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <button type="button" onClick={() => setViewing(b)} className="text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400">
                      Details
                    </button>
                  </td>
                </tr>
              );
            })}
            {bookings.length === 0 && (
              <tr>
                <td colSpan={8} className="px-5 py-6 text-center text-sm text-slate-400 dark:text-slate-500">
                  No bookings in this range.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {viewing && <BookingViewModal booking={viewing} roomType={categories.find((c) => c.id === viewing.roomCategoryId)?.name ?? '—'} onClose={() => setViewing(null)} />}
    </Card>
  );
}
