import { Badge, Card } from '../components/ui';
import { ChannelBadge } from './channel-manager/ChannelBadge';
import { computeInvoiceTotals } from '../invoice';
import type { Booking } from '../types';

/**
 * Read-only billing view for a reservation — Channel Manager's bookings arrive automatically via
 * the channel (or its simulator, until a real API is live), so there's nothing to edit here, only
 * to see: what the guest booked, through which channel, and the full invoice breakdown.
 */
export function BookingViewModal({ booking, onClose }: { booking: Booking; onClose: () => void }) {
  const totals = computeInvoiceTotals({
    totalAmount: Number(booking.totalAmount),
    lineItems: booking.lineItems ?? [],
    discountAmount: booking.discountAmount ? Number(booking.discountAmount) : null,
    gstExempt: booking.gstExempt,
  });
  const paid = Number(booking.paidAmount ?? 0);
  const due = Math.max(0, totals.grandTotal - paid);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <Card className="max-h-[85vh] overflow-y-auto">
          <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">{booking.guestName}</h3>
              <p className="mt-1 text-xs text-slate-500">
                {booking.checkIn.slice(0, 10)} → {booking.checkOut.slice(0, 10)} · {booking.nights} night{booking.nights === 1 ? '' : 's'}
              </p>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
              ✕
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3">
            <Badge tone={booking.status}>{booking.status}</Badge>
            <ChannelBadge source={booking.source} />
            {booking.guestPhone && <span className="text-xs text-slate-500">{booking.guestPhone}</span>}
          </div>

          <div className="space-y-1.5 px-5 py-4 text-sm">
            <div className="flex justify-between text-slate-500">
              <span>Room charge</span>
              <span>₹{totals.basePrice.toFixed(2)}</span>
            </div>
            {(booking.lineItems ?? []).map((li) => (
              <div key={li.id} className="flex justify-between text-slate-500">
                <span>
                  {li.description} × {li.quantity}
                </span>
                <span>₹{Number(li.amount).toFixed(2)}</span>
              </div>
            ))}
            {totals.discount > 0 && (
              <div className="flex justify-between text-amber-600">
                <span>Discount</span>
                <span>−₹{totals.discount.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-slate-500">
              <span>
                GST <span className="text-slate-400">({totals.gst.rate}%)</span>
              </span>
              <span>₹{totals.gst.amount.toFixed(2)}</span>
            </div>
            <div className="mt-2 flex justify-between rounded-lg bg-brand-50 px-3 py-2 text-base font-semibold text-brand-700">
              <span>Total</span>
              <span>₹{totals.grandTotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-slate-500">
              <span>Paid</span>
              <span>₹{paid.toFixed(2)}</span>
            </div>
            <div className={`flex justify-between font-medium ${due > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
              <span>Due</span>
              <span>{due > 0 ? `₹${due.toFixed(2)}` : 'Paid in full'}</span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
