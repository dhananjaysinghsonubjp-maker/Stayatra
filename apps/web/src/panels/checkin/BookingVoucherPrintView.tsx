import { useEffect, useRef, useState } from 'react';
import { assetUrl, query } from '../../api';
import { useAuth } from '../../AuthContext';
import { Button } from '../../components/ui';
import { exportTablesToCsv } from '../../csvExport';
import { formatDateShort } from '../../dateFormat';
import { amountInWords } from '../../numberToWords';
import type { Hotel } from '../../types';
import type { ReservationSuccessData } from './ReservationSuccessModal';

// Standard GST SAC code for "accommodation, food and beverage services" (hotel rooms) — same
// code used across the industry's own booking vouchers/invoices.
const ROOM_HSN_SAC = '996311';

/**
 * §user request, with a reference app's own Booking Voucher PDF as the target — same
 * window.print()/"Save as PDF" mechanism InvoicePrintView already uses, not a new PDF library.
 * One line-item row per physical room (not per category), a Grand Total/Advance Paid/Balance
 * block with the advance spelled out in words, and a Payment Details table listing each mode
 * this reservation's advance was actually split across.
 */
export function BookingVoucherPrintView({ data, onClose }: { data: ReservationSuccessData; onClose: () => void }) {
  const { token } = useAuth();
  const [hotel, setHotel] = useState<Hotel | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    query<Hotel>('hotels.get', { hotelId: data.hotelId }, token ?? undefined).then(setHotel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.hotelId]);

  const addressParts = hotel ? [hotel.addressLine, hotel.apartmentOrFloor, hotel.city, hotel.state, hotel.pincode].filter(Boolean) : [];
  const roomsSubtotal = data.rooms.reduce((sum, r) => sum + r.total, 0);
  const totalPaid = data.grandTotal - data.due;

  return (
    <div className="invoice-print-root fixed inset-0 z-[80] overflow-y-auto bg-slate-900/40 print:bg-white">
      <div ref={contentRef} className="mx-auto my-8 max-w-3xl rounded-xl border border-slate-200 bg-white p-8 shadow-xl print:my-0 print:max-w-none print:rounded-none print:border-none print:p-0 print:shadow-none">
        {!hotel ? (
          <p className="py-20 text-center text-sm text-slate-400">Loading…</p>
        ) : (
          <>
            <div className="flex items-start justify-between gap-4 border-b border-slate-300 pb-3">
              <div className="flex items-start gap-3">
                {hotel.logoFilePath && <img src={assetUrl(hotel.logoFilePath)} alt={hotel.name} className="h-12 w-12 shrink-0 rounded-lg object-cover" />}
                <div>
                  <p className="text-sm font-bold text-slate-900">{hotel.name}</p>
                  {addressParts.length > 0 && <p className="max-w-xs text-xs text-slate-500">{addressParts.join(', ')}</p>}
                  {hotel.gstRegistration && <p className="text-xs text-slate-500">GST No: {hotel.gstRegistration}</p>}
                  {hotel.contactMobile && <p className="text-xs text-slate-500">Phone: {hotel.contactMobile}</p>}
                  {hotel.contactEmail && <p className="text-xs text-slate-500">Email: {hotel.contactEmail}</p>}
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs font-semibold text-slate-900">{data.bookingCode}</p>
                <p className="text-xs text-slate-500">Voucher Date: {formatDateShort(data.createdAt)}</p>
              </div>
            </div>
            <p className="mt-2 text-center text-lg font-bold text-slate-900">Booking Voucher</p>

            <div className="mt-4 flex items-center justify-between">
              <p className="text-sm font-bold text-slate-900">Guest &amp; Stay Details</p>
              {hotel.state && <p className="text-xs text-slate-500">Place of Supply: {hotel.state}</p>}
            </div>
            <div className="mt-2 grid grid-cols-4 gap-x-4 gap-y-3 rounded-lg bg-slate-50 p-4 text-sm">
              <VoucherField label="Guest Name" value={data.guestName} />
              <VoucherField label="Mobile Number" value={data.guestPhone ? `+91 ${data.guestPhone}` : '—'} />
              <VoucherField label="Company Name" value={data.companyName || '—'} />
              <VoucherField label="GSTIN" value={data.companyGstin || '—'} />
              <VoucherField label="Check-in" value={formatDateShort(data.checkIn)} />
              <VoucherField label="Check-out" value={formatDateShort(data.checkOut)} />
              <VoucherField label="Nights Stayed" value={String(data.nights)} />
              <VoucherField label="No. of Rooms" value={String(data.rooms.length)} />
              <div className="col-span-4">
                <VoucherField label="Customer Address" value="-" />
              </div>
            </div>

            <table className="mt-5 w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-300 text-left text-xs font-semibold text-slate-500">
                  <th className="py-2">Description</th>
                  <th className="py-2">HSN/SAC</th>
                  <th className="py-2 text-right">Qty</th>
                  <th className="py-2 text-right">Unit Price</th>
                  <th className="py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                <tr className="bg-slate-50">
                  <td colSpan={5} className="px-1 py-1.5 text-xs font-bold text-slate-600">
                    Room Charges
                  </td>
                </tr>
                {data.rooms.map((r, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="py-2.5 text-slate-700">
                      {r.categoryName}
                      {r.ratePlanName ? ` (${r.ratePlanName})` : ''}
                    </td>
                    <td className="py-2.5 text-slate-500">{ROOM_HSN_SAC}</td>
                    <td className="py-2.5 text-right text-slate-700">
                      {r.nights} Night{r.nights === 1 ? '' : 's'}
                    </td>
                    <td className="py-2.5 text-right text-slate-700">₹{r.ratePerNight.toFixed(2)}</td>
                    <td className="py-2.5 text-right text-slate-700">₹{r.total.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-3 space-y-1.5 text-sm">
              <div className="flex justify-between text-slate-500">
                <span>Subtotal</span>
                <span>₹{roomsSubtotal.toFixed(2)}</span>
              </div>
              {data.extraCharges > 0 && (
                <div className="flex justify-between text-slate-500">
                  <span>Add-ons</span>
                  <span>₹{data.extraCharges.toFixed(2)}</span>
                </div>
              )}
              {data.discount > 0 && (
                <div className="flex justify-between text-amber-600">
                  <span>Discount</span>
                  <span>−₹{data.discount.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-slate-500">
                <span>GST ({data.gstLabel})</span>
                <span>₹{data.gstAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-1.5 text-base font-bold text-slate-900">
                <span>Grand Total:</span>
                <span>₹{data.grandTotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-semibold text-emerald-600">
                <span>Advance Paid:</span>
                <span>₹{data.advanceAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-semibold text-slate-700">
                <span>Total Paid:</span>
                <span>₹{totalPaid.toFixed(2)}</span>
              </div>
              <p className="text-right text-xs italic text-slate-400">{amountInWords(totalPaid)}</p>
              <div className="flex justify-between border-t border-slate-200 pt-1.5 text-base font-bold text-red-500">
                <span>Balance:</span>
                <span>₹{data.due.toFixed(2)}</span>
              </div>
            </div>

            {data.payments.length > 0 && (
              <>
                <p className="mt-5 text-sm font-bold text-slate-900">Payment Details</p>
                <table className="mt-1.5 w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-300 text-left text-xs font-semibold text-slate-500">
                      <th className="py-2">Date</th>
                      <th className="py-2">Type</th>
                      <th className="py-2">Reference</th>
                      <th className="py-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.payments.map((p, i) => (
                      <tr key={i} className="border-b border-slate-100 text-slate-700">
                        <td className="py-2">{formatDateShort(p.collectedAt ?? data.createdAt)}</td>
                        <td className="py-2">Advance Payment ({p.modeLabel})</td>
                        <td className="py-2">{p.referenceNumber || 'NA'}</td>
                        <td className="py-2 text-right">₹{p.amount.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            <div className="mt-8 text-center">
              <p className="text-sm font-bold text-slate-900">Thank you for choosing to stay with us!</p>
              <p className="text-xs text-slate-500">We look forward to welcoming you again.</p>
            </div>
          </>
        )}
      </div>

      <div className="no-print fixed bottom-6 right-6 flex gap-2">
        <button
          type="button"
          onClick={() => contentRef.current && exportTablesToCsv(contentRef.current, 'Booking Voucher')}
          disabled={!hotel}
          title="Download this voucher as a CSV spreadsheet"
          className="flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3.5 py-2 text-sm font-semibold text-emerald-700 transition-colors hover:border-emerald-400 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
            <path d="M4 4h10l6 6v10a1 1 0 01-1 1H4a1 1 0 01-1-1V5a1 1 0 011-1z" />
            <path d="M9 13h6M9 16.5h6M9 9.5h2" />
          </svg>
          CSV
        </button>
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

function VoucherField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="font-semibold text-slate-900">{value}</p>
    </div>
  );
}
