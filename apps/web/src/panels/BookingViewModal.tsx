import { useState } from 'react';
import { Badge, Button, Card } from '../components/ui';
import { ChannelBadge } from './channel-manager/ChannelBadge';
import { InvoicePrintView } from './InvoicePrintView';
import { computeInvoiceTotals } from '../invoice';
import { paymentMethodLabel } from '../paymentMethods';
import { formatDateShort as formatDateFull, formatDateTimeShort as formatDateTime } from '../dateFormat';
import type { Booking, PaymentMethod } from '../types';

const BREAKDOWN_LABELS: Record<string, string> = {
  roomCharges: 'Room Charges',
  extraAdultChild: 'Extra Adult/Child Charges',
  feesAndCharges: 'Fees & Charges',
  taxes: 'Taxes',
  grossCharges: 'Gross Charges (payable by guest)',
  commission: 'Channel Commission',
  commissionGst: 'GST on Commission',
  tcs: 'TCS',
  tds: 'TDS',
  netPayableToProperty: 'Net Payable to Property',
  hostServiceFee: 'Host Service Fee',
  occupancyTax: 'Occupancy Tax (remitted by channel)',
  guestPaidTotal: 'Guest Paid (Total)',
  commissionableAmount: 'Commissionable Amount',
  estimatedCommission: 'Estimated Commission',
  promotionsApplied: 'Promotions Applied',
  rateType: 'Rate Type',
  inclusions: 'Inclusions',
  specialRequests: 'Special Requests',
  companyName: 'Booked For (Company)',
};

function humanizeKey(key: string) {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
}


/** One "Label  Value" row — the detail list's own primitive (§ user request, matching a reference
 * booking-details popup's content, restyled to this app's own label/value convention instead of
 * literally copying that reference's "Label:-" inline text). */
function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="shrink-0 text-xs text-slate-400 dark:text-slate-500">{label}</span>
      <span className="text-right text-sm font-medium text-slate-900 dark:text-white">{children}</span>
    </div>
  );
}

/** The channel's own voucher breakdown — numeric fields as ₹ amounts, text fields (promotions, notes) as-is. */
function ChannelBreakdown({ data }: { data: Record<string, string | number> }) {
  return (
    <div className="space-y-1.5 border-t border-slate-100 px-5 py-4 text-sm dark:border-slate-700">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Channel payout breakdown</p>
      {Object.entries(data).map(([key, value]) => (
        <div key={key} className="flex justify-between gap-4 text-slate-600 dark:text-slate-400">
          <span className="shrink-0">{BREAKDOWN_LABELS[key] ?? humanizeKey(key)}</span>
          <span className={`text-right ${typeof value === 'number' ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>
            {typeof value === 'number' ? `₹${value.toFixed(2)}` : value}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Read-only billing view for a reservation (§ user request — full "Booking Details" popup,
 * matching a reference product's comprehensive detail view). Channel Manager's bookings arrive
 * automatically via the channel (or its simulator, until a real API is live), so there's nothing
 * to edit here, only to see. Every field below comes from real data this app actually tracks —
 * fields the reference also showed (total adults/children, number of rooms, a per-room "Plan")
 * aren't in this data model yet, so they're left out rather than shown with a made-up number.
 */
export function BookingViewModal({
  booking,
  roomType,
  onClose,
  onCheckIn,
  onCancel,
  onAddPayment,
}: {
  booking: Booking;
  roomType: string;
  onClose: () => void;
  /** §user request, matching a reference app's Booking Details screen — primary actions live
   * here now, not just on the list row. Each is optional so read-only callers (Calendar, In-House)
   * can keep showing this exact same modal without any action capability leaking in. */
  onCheckIn?: () => void;
  onCancel?: () => void;
  onAddPayment?: () => void;
}) {
  const [printing, setPrinting] = useState(false);
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
        <Card className="max-h-[85vh] overflow-y-auto overflow-x-hidden">
          <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-700">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">Booking Details</h3>
            <div className="flex items-center gap-3">
              <Button type="button" variant="secondary" className="text-xs" onClick={() => setPrinting(true)}>
                Print Invoice
              </Button>
              <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300">
                ✕
              </button>
            </div>
          </div>

          {(onCheckIn || onCancel) && (
            <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3 dark:border-slate-700">
              {onCheckIn && (
                <Button type="button" className="flex-1" onClick={onCheckIn}>
                  Start Check-in
                </Button>
              )}
              {onCancel && (
                <Button type="button" variant="danger" className={onCheckIn ? '' : 'flex-1'} onClick={onCancel}>
                  Cancel Reservation
                </Button>
              )}
            </div>
          )}

          <div className="divide-y divide-slate-100 px-5 dark:divide-slate-700">
            <div className="py-1">
              <DetailRow label="Booking ID">{booking.id}</DetailRow>
              <DetailRow label="Guest Name">{booking.guestName}</DetailRow>
              <DetailRow label="Room Type">{roomType}</DetailRow>
              <DetailRow label="Status">
                <Badge tone={booking.status}>{booking.status}</Badge>
              </DetailRow>
              <DetailRow label="Check In">{formatDateFull(booking.checkIn)}</DetailRow>
              <DetailRow label="Nights">{booking.nights}</DetailRow>
              <DetailRow label="Check Out">{formatDateFull(booking.checkOut)}</DetailRow>
              {booking.checkedOutAt && <DetailRow label="Checked Out At">{formatDateTime(booking.checkedOutAt)}</DetailRow>}
              <DetailRow label="OTA Platform">
                <span className="inline-flex justify-end">
                  <ChannelBadge source={booking.source} />
                </span>
              </DetailRow>
              <DetailRow label="Booking Date">{formatDateTime(booking.createdAt)}</DetailRow>
              <DetailRow label="Guest Mobile">{booking.guestPhone ?? 'Not provided'}</DetailRow>
              {booking.otaBookingRef && <DetailRow label="OTA Reference">{booking.otaBookingRef}</DetailRow>}
            </div>
          </div>

          <div className="px-5 py-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Charges</p>
            <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-brand-600 text-left text-xs font-semibold text-white">
                    <th className="px-3 py-2">Room Type</th>
                    <th className="px-3 py-2">Room Charge</th>
                    <th className="px-3 py-2">GST ({totals.gst.rate}%)</th>
                    <th className="px-3 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="bg-white dark:bg-slate-800">
                    <td className="px-3 py-2.5 text-slate-700 dark:text-slate-300">{roomType}</td>
                    <td className="px-3 py-2.5 text-slate-700 dark:text-slate-300">₹{totals.basePrice.toFixed(2)}</td>
                    <td className="px-3 py-2.5 text-slate-700 dark:text-slate-300">₹{totals.gst.amount.toFixed(2)}</td>
                    <td className="px-3 py-2.5 text-right font-medium text-slate-900 dark:text-white">₹{(totals.basePrice + totals.gst.amount).toFixed(2)}</td>
                  </tr>
                  {(booking.lineItems ?? []).map((li) => (
                    <tr key={li.id} className="bg-slate-50 dark:bg-slate-800/60">
                      <td className="px-3 py-2.5 text-slate-500 dark:text-slate-400" colSpan={3}>
                        {li.description} × {li.quantity}
                      </td>
                      <td className="px-3 py-2.5 text-right text-slate-700 dark:text-slate-300">₹{Number(li.amount).toFixed(2)}</td>
                    </tr>
                  ))}
                  {totals.discount > 0 && (
                    <tr className="bg-white dark:bg-slate-800">
                      <td className="px-3 py-2.5 text-amber-600 dark:text-amber-400" colSpan={3}>
                        Discount
                      </td>
                      <td className="px-3 py-2.5 text-right text-amber-600 dark:text-amber-400">−₹{totals.discount.toFixed(2)}</td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="border-t border-slate-200 bg-brand-50 dark:border-slate-700 dark:bg-brand-500/10">
                    <td className="px-3 py-2.5 text-sm font-bold text-brand-700 dark:text-brand-400" colSpan={3}>
                      Total
                    </td>
                    <td className="px-3 py-2.5 text-right text-sm font-bold text-brand-700 dark:text-brand-400">₹{totals.grandTotal.toFixed(2)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <div className="space-y-1.5 border-t border-slate-100 px-5 py-4 text-sm dark:border-slate-700">
            <div className="flex justify-between text-slate-500 dark:text-slate-400">
              <span>Payment Method</span>
              <span className="text-slate-700 dark:text-slate-300">{booking.paymentMethod ? paymentMethodLabel(booking.paymentMethod as PaymentMethod) : '—'}</span>
            </div>
            <div className="flex justify-between text-slate-500 dark:text-slate-400">
              <span>Paid</span>
              <span className="text-slate-900 dark:text-white">₹{paid.toFixed(2)}</span>
            </div>
            <div className={`flex items-center justify-between font-medium ${due > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
              <span>Due</span>
              <span className="flex items-center gap-2">
                {due > 0 ? `₹${due.toFixed(2)}` : 'Paid in full'}
                {due > 0 && onAddPayment && (
                  <Button type="button" variant="secondary" className="!px-2.5 !py-1 text-xs" onClick={onAddPayment}>
                    Add Payment
                  </Button>
                )}
              </span>
            </div>
          </div>

          {booking.channelBreakdown && <ChannelBreakdown data={booking.channelBreakdown} />}

          {booking.otaCancellationPolicy && (
            <div className="border-t border-slate-100 px-5 py-4 dark:border-slate-700">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Cancellation policy</p>
              <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">{booking.otaCancellationPolicy}</p>
            </div>
          )}
        </Card>
      </div>

      {printing && <InvoicePrintView booking={booking} roomType={roomType} onClose={() => setPrinting(false)} />}
    </div>
  );
}
