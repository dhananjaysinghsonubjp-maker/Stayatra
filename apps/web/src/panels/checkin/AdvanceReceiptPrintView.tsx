import { useEffect, useState } from 'react';
import { assetUrl, query } from '../../api';
import { useAuth } from '../../AuthContext';
import { Button } from '../../components/ui';
import { formatDateShort, formatDateTimeShort } from '../../dateFormat';
import { amountInWords } from '../../numberToWords';
import { paymentMethodLabel } from '../../paymentMethods';
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

  useEffect(() => {
    query<Hotel>('hotels.get', { hotelId: data.hotelId }, token ?? undefined).then(setHotel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.hotelId]);

  const addressParts = hotel ? [hotel.addressLine, hotel.apartmentOrFloor, hotel.city, hotel.state, hotel.pincode].filter(Boolean) : [];
  const roomNumbers = data.rooms.map((r) => r.roomNumber).join(', ');
  const roomTypes = [...new Set(data.rooms.map((r) => r.categoryName))].join(', ');
  const paymentModes = [...new Set(data.payments.map((p) => paymentMethodLabel(p.method)))].join(', ') || '—';
  const refNumbers = data.payments.map((p) => p.referenceNumber).filter(Boolean).join(', ') || '—';
  const narration = data.due > 0 ? 'PARTIALLY PAID' : 'FULLY PAID';

  return (
    <div className="invoice-print-root fixed inset-0 z-[80] overflow-y-auto bg-slate-900/40 print:bg-white">
      <div className="mx-auto my-8 max-w-2xl rounded-xl border border-slate-200 bg-white p-8 shadow-xl print:my-0 print:max-w-none print:rounded-none print:border-none print:p-0 print:shadow-none">
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
              <p>
                a Sum of Rs.{' '}
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
