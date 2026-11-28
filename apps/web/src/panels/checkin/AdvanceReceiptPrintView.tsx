import { useEffect, useRef, useState } from 'react';
import { assetUrl, query } from '../../api';
import { useAuth } from '../../AuthContext';
import { Button } from '../../components/ui';
import { exportTablesToCsv } from '../../csvExport';
import { formatDateShort, formatDateTimeShort } from '../../dateFormat';
import { amountInWords } from '../../numberToWords';
import type { Hotel } from '../../types';
import type { ReservationSuccessData } from './ReservationSuccessModal';

/**
 * §user request, with a reference app's own cash/advance receipt as the target — same
 * window.print()/"Save as PDF" mechanism InvoicePrintView already uses app-wide, not a new PDF
 * library. One row per booking (room numbers + types combined), "Amount Received from <guest>",
 * the advance figure spelled out in words, and a Partially/Fully Paid narration.
 */
export function AdvanceReceiptPrintView({ data, onClose }: { data: ReservationSuccessData; onClose: () => void }) {
  const { token } = useAuth();
  const [hotel, setHotel] = useState<Hotel | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    query<Hotel>('hotels.get', { hotelId: data.hotelId }, token ?? undefined).then(setHotel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.hotelId]);

  const addressParts = hotel ? [hotel.addressLine, hotel.apartmentOrFloor, hotel.city, hotel.state, hotel.pincode].filter(Boolean) : [];
  const roomNumbers = data.rooms.map((r) => r.roomNumber).join(', ');
  const roomTypes = [...new Set(data.rooms.map((r) => r.categoryName))].join(', ');
  const paymentModes = [...new Set(data.payments.map((p) => p.modeLabel))].join(', ') || '—';
  const refNumbers = data.payments.map((p) => p.referenceNumber).filter(Boolean).join(', ') || '—';
  const narration = data.due > 0 ? 'PARTIALLY PAID' : 'FULLY PAID';
  // §user request — "jo recent amount advance humne receive kiya ho vo thoda different colour
  // mein ho": every payment this reservation has ever collected gets its own dated row (not just
  // one lump sum), oldest first, with whichever one is most recent highlighted — so a reprinted
  // receipt after a second Record Payment shows both transactions, not just the new total.
  const sortedPayments = [...data.payments].sort((a, b) => (a.collectedAt ?? data.createdAt).localeCompare(b.collectedAt ?? data.createdAt));
  const latestIndex = sortedPayments.length - 1;

  return (
    <div className="invoice-print-root fixed inset-0 z-[80] overflow-y-auto bg-slate-900/40 print:bg-white">
      <div ref={contentRef} className="mx-auto my-8 max-w-2xl rounded-xl border border-slate-200 bg-white p-8 shadow-xl print:my-0 print:max-w-none print:rounded-none print:border-none print:p-0 print:shadow-none">
        {!hotel ? (
          <p className="py-20 text-center text-sm text-slate-400">Loading…</p>
        ) : (
          <>
            <div className="flex items-start justify-between gap-4 border-b border-slate-300 pb-3">
              {hotel.logoFilePath && <img src={assetUrl(hotel.logoFilePath)} alt={hotel.name} className="h-12 w-12 shrink-0 rounded-lg object-cover" />}
              <div className="flex-1 text-center">
                <p className="text-xl font-bold text-slate-900">{hotel.name}</p>
                {addressParts.length > 0 && <p className="text-xs text-slate-500">{addressParts.join(', ')}</p>}
                <p className="text-xs text-slate-500">
                  {hotel.contactMobile ? `Phone: ${hotel.contactMobile}` : ''}
                  {hotel.contactMobile && hotel.contactEmail ? ', ' : ''}
                  {hotel.contactEmail ? `Email: ${hotel.contactEmail}` : ''}
                </p>
              </div>
              {hotel.logoFilePath && <div className="h-12 w-12 shrink-0" />}
            </div>

            <div className="mt-4 flex items-center justify-between text-sm">
              <p className="text-slate-600">
                Receipt.No : <span className="font-bold text-slate-900">{data.bookingCode}</span>
              </p>
              <p className="text-2xl font-bold text-slate-900">Receipt</p>
              <p className="text-slate-600">
                Date : <span className="font-bold text-slate-900">{formatDateTimeShort(data.createdAt)}</span>
              </p>
            </div>

            <table className="mt-4 w-full border-collapse text-sm">
              <thead>
                <tr className="border border-slate-300 bg-slate-50 text-xs font-semibold text-slate-600">
                  <th className="border border-slate-300 px-2 py-2">Booking ID</th>
                  <th className="border border-slate-300 px-2 py-2">Room No.</th>
                  <th className="border border-slate-300 px-2 py-2">Room Type</th>
                  <th className="border border-slate-300 px-2 py-2">Tariff</th>
                  <th className="border border-slate-300 px-2 py-2">Ref. No.</th>
                  <th className="border border-slate-300 px-2 py-2">Payment Mode</th>
                </tr>
              </thead>
              <tbody>
                <tr className="text-center text-slate-700">
                  <td className="border border-slate-300 px-2 py-2 font-semibold">{data.bookingCode}</td>
                  <td className="border border-slate-300 px-2 py-2">{roomNumbers}</td>
                  <td className="border border-slate-300 px-2 py-2">{roomTypes}</td>
                  <td className="border border-slate-300 px-2 py-2">{data.grandTotal.toFixed(2)}</td>
                  <td className="border border-slate-300 px-2 py-2">{refNumbers}</td>
                  <td className="border border-slate-300 px-2 py-2">{paymentModes}</td>
                </tr>
              </tbody>
            </table>

            <div className="mt-6 space-y-4 text-sm text-slate-800">
              <p>
                Amount Received from <span className="border-b border-dotted border-slate-400 font-bold">{data.guestName}</span>
              </p>

              {sortedPayments.length > 0 && (
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-300 text-left font-semibold text-slate-500">
                      <th className="py-1.5">Date &amp; Time</th>
                      <th className="py-1.5">Mode</th>
                      <th className="py-1.5 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedPayments.map((p, i) => {
                      // §user request — "agar koi 2 payment advance aata hai toh vo highlight
                      // honi chahiye": the highlight only means anything once there's more than
                      // one row to tell apart — a single payment has no "earlier" one to be the
                      // latest relative to.
                      const isLatest = sortedPayments.length > 1 && i === latestIndex;
                      return (
                        <tr key={i} className={isLatest ? 'bg-emerald-50 font-bold text-emerald-700' : 'text-slate-700'}>
                          <td className="py-1.5 pl-1">{formatDateTimeShort(p.collectedAt ?? data.createdAt)}</td>
                          <td className="py-1.5">
                            {p.modeLabel}
                            {isLatest ? ' (Latest)' : ''}
                          </td>
                          <td className="py-1.5 pr-1 text-right">₹{p.amount.toFixed(2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}

              <p>
                Total Advance Received: Rs.{' '}
                <span className="border-b border-dotted border-slate-400 font-bold">
                  {data.advanceAmount.toFixed(2)} ( {amountInWords(data.advanceAmount)} )
                </span>
              </p>
              <p>towards Advance Payment (Arrival : {formatDateShort(data.checkIn)})</p>
              <div>
                <p className="font-bold">Narration</p>
                <p>{narration}</p>
              </div>
            </div>

            <div className="mt-16 grid grid-cols-3 gap-6 border-t border-slate-200 pt-3 text-sm font-semibold text-slate-700">
              <p>Guest Sign</p>
              <p className="text-center">Manager Sign</p>
              <p className="text-right">Receptionist Sign</p>
            </div>
          </>
        )}
      </div>

      <div className="no-print fixed bottom-6 right-6 flex gap-2">
        <button
          type="button"
          onClick={() => contentRef.current && exportTablesToCsv(contentRef.current, 'Advance Receipt')}
          disabled={!hotel}
          title="Download this receipt as a CSV spreadsheet"
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
