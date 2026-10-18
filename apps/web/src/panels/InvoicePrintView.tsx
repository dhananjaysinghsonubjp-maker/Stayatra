import { useEffect, useState } from 'react';
import { assetUrl, query } from '../api';
import { useAuth } from '../AuthContext';
import { Button } from '../components/ui';
import { computeInvoiceTotals } from '../invoice';
import { paymentMethodLabel } from '../paymentMethods';
import { formatDateShort } from '../dateFormat';
import type { Booking, Hotel, PaymentMethod } from '../types';

/**
 * §user request — "Invoice customization hum add kar sakte hain": a real printable/downloadable
 * tax invoice (there wasn't one before — BookingViewModal only showed a read-only breakdown in a
 * modal). Reads the Invoice Settings a hotel sets up (Settings → Invoice Settings): licence
 * number, UPI id, stamp, and the two "what prints" toggles — plus the GST registration/PAN/bank
 * details already captured in Hotel Details, so nothing is duplicated.
 *
 * Printing uses the browser's own print dialog (`window.print()`) rather than a PDF library —
 * `.invoice-print-root`/`.no-print` in index.css isolate this element so the rest of the app
 * (sidebar, header, backdrop) don't end up on the printed page. "Save as PDF" in that dialog
 * covers the "download" case without a server-side PDF dependency.
 */
export function InvoicePrintView({ booking, roomType, onClose }: { booking: Booking; roomType: string; onClose: () => void }) {
  const { token } = useAuth();
  const [hotel, setHotel] = useState<Hotel | null>(null);

  useEffect(() => {
    query<Hotel>('hotels.get', { hotelId: booking.hotelId }, token ?? undefined).then(setHotel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking.hotelId]);

  const totals = computeInvoiceTotals({
    totalAmount: Number(booking.totalAmount),
    lineItems: booking.lineItems ?? [],
    discountAmount: booking.discountAmount ? Number(booking.discountAmount) : null,
    gstExempt: booking.gstExempt,
  });
  const paid = Number(booking.paidAmount ?? 0);
  const due = Math.max(0, totals.grandTotal - paid);

  const addressParts = hotel ? [hotel.addressLine, hotel.city, hotel.state, hotel.pincode].filter(Boolean) : [];

  return (
    <div className="invoice-print-root fixed inset-0 z-[60] overflow-y-auto bg-slate-900/40 print:bg-white">
      <div className="mx-auto my-8 max-w-2xl rounded-xl bg-white p-8 shadow-xl print:my-0 print:max-w-none print:rounded-none print:p-0 print:shadow-none">
        {!hotel ? (
          <p className="py-20 text-center text-sm text-slate-400">Loading…</p>
        ) : (
          <>
            <div className="flex items-start justify-between border-b border-slate-200 pb-4">
              <div>
                {hotel.logoFilePath && <img src={assetUrl(hotel.logoFilePath)} alt={hotel.name} className="mb-2 h-10 w-10 rounded-lg object-cover" />}
                <p className="text-lg font-bold text-slate-900">{hotel.name}</p>
                {addressParts.length > 0 && <p className="max-w-xs text-xs text-slate-500">{addressParts.join(', ')}</p>}
                {hotel.contactMobile && <p className="text-xs text-slate-500">{hotel.contactMobile}</p>}
                {hotel.gstRegistration && <p className="text-xs text-slate-500">GSTIN: {hotel.gstRegistration}</p>}
                {hotel.licenseNumber && <p className="text-xs text-slate-500">Licence No.: {hotel.licenseNumber}</p>}
              </div>
              <div className="text-right">
                <p className="text-xl font-bold tracking-wide text-slate-900">TAX INVOICE</p>
                <p className="mt-1 font-mono text-xs text-slate-400">{booking.id}</p>
                <p className="text-xs text-slate-400">{formatDateShort(booking.createdAt)}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6 py-4 text-sm">
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Billed to</p>
                <p className="font-medium text-slate-900">{booking.guestName}</p>
                {booking.guestPhone && <p className="text-xs text-slate-500">{booking.guestPhone}</p>}
              </div>
              <div className="text-right">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Stay</p>
                <p className="text-slate-700">
                  {formatDateShort(booking.checkIn)} → {formatDateShort(booking.checkOut)} · {booking.nights}N
                </p>
                <p className="text-xs text-slate-500">{roomType}</p>
              </div>
            </div>

            <table className="w-full text-sm">
              <thead>
                <tr className="bg-brand-600 text-left text-xs font-semibold text-white">
                  <th className="px-3 py-2">Description</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-slate-100">
                  <td className="px-3 py-2.5 text-slate-700">
                    {roomType} · Room charge ({booking.nights}N)
                  </td>
                  <td className="px-3 py-2.5 text-right text-slate-700">₹{totals.basePrice.toFixed(2)}</td>
                </tr>
                {(booking.lineItems ?? []).map((li) => (
                  <tr key={li.id} className="border-b border-slate-100">
                    <td className="px-3 py-2.5 text-slate-700">
                      {li.description} × {li.quantity}
                    </td>
                    <td className="px-3 py-2.5 text-right text-slate-700">₹{Number(li.amount).toFixed(2)}</td>
                  </tr>
                ))}
                {totals.discount > 0 && (
                  <tr className="border-b border-slate-100">
                    <td className="px-3 py-2.5 text-amber-600">Discount</td>
                    <td className="px-3 py-2.5 text-right text-amber-600">−₹{totals.discount.toFixed(2)}</td>
                  </tr>
                )}
                <tr className="border-b border-slate-100">
                  <td className="px-3 py-2.5 text-slate-500">GST ({totals.gst.rate}%)</td>
                  <td className="px-3 py-2.5 text-right text-slate-500">₹{totals.gst.amount.toFixed(2)}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr className="bg-brand-50">
                  <td className="px-3 py-2.5 text-sm font-bold text-brand-700">Total</td>
                  <td className="px-3 py-2.5 text-right text-sm font-bold text-brand-700">₹{totals.grandTotal.toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>

            {hotel.showPaymentSummaryOnInvoice && (
              <div className="mt-4 space-y-1 border-t border-slate-200 pt-3 text-sm">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Payment summary</p>
                <div className="flex justify-between text-slate-600">
                  <span>Method</span>
                  <span>{booking.paymentMethod ? paymentMethodLabel(booking.paymentMethod as PaymentMethod) : '—'}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Paid</span>
                  <span>₹{paid.toFixed(2)}</span>
                </div>
                <div className={`flex justify-between font-medium ${due > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                  <span>Due</span>
                  <span>{due > 0 ? `₹${due.toFixed(2)}` : 'Paid in full'}</span>
                </div>
              </div>
            )}

            {(hotel.upiId || hotel.bankAccountNumber) && (
              <div className="mt-4 border-t border-slate-200 pt-3 text-xs text-slate-500">
                <p className="mb-1 font-semibold uppercase tracking-wide text-slate-400">Payment details</p>
                {hotel.upiId && <p>UPI: {hotel.upiId}</p>}
                {hotel.bankAccountNumber && (
                  <p>
                    {hotel.bankAccountHolderName ? `${hotel.bankAccountHolderName} · ` : ''}
                    A/C {hotel.bankAccountNumber}
                    {hotel.bankIfsc ? ` · IFSC ${hotel.bankIfsc}` : ''}
                  </p>
                )}
              </div>
            )}

            {hotel.showTermsOnInvoice && hotel.invoiceTerms && (
              <div className="mt-4 border-t border-slate-200 pt-3">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Terms & Conditions</p>
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-slate-500">{hotel.invoiceTerms}</p>
              </div>
            )}

            {hotel.invoiceStampPath && (
              <div className="mt-6 flex justify-end">
                <img src={assetUrl(hotel.invoiceStampPath)} alt="Stamp" className="h-20 w-20 object-contain" />
              </div>
            )}
          </>
        )}
      </div>

      <div className="no-print fixed bottom-6 right-6 flex gap-2">
        <Button type="button" onClick={() => window.print()} disabled={!hotel}>
          Print / Save as PDF
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}
