import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../../components/ui';
import { formatDateTimeShort } from '../../dateFormat';
import { AdvanceReceiptPrintView } from './AdvanceReceiptPrintView';
import { BookingVoucherPrintView } from './BookingVoucherPrintView';

export interface ReservationSuccessRoom {
  roomNumber: string;
  categoryName: string;
  ratePlanName?: string;
  ratePerNight: number;
  nights: number;
  total: number;
}

export interface ReservationSuccessPayment {
  /** Pre-formatted mode label (e.g. "Cash" or, for a transaction that was itself split across
   * more than one mode, "Cash + UPI") — computed once wherever this array is built, not a raw
   * PaymentMethod, since one logical transaction can cover more than one mode. */
  modeLabel: string;
  amount: number;
  referenceNumber?: string;
  /** When this specific transaction was collected — lets the receipt show every payment as its
   * own dated row instead of one lump sum, and highlight whichever is most recent. Falls back to
   * the reservation's own createdAt for a fresh creation, where every payment was just collected
   * "now" and has no real per-transaction timestamp of its own yet. */
  collectedAt?: string;
}

export interface ReservationSuccessData {
  hotelId: string;
  bookingCode: string;
  createdAt: string;
  guestName: string;
  guestPhone?: string;
  companyName?: string;
  companyGstin?: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  rooms: ReservationSuccessRoom[];
  extraCharges: number;
  discount: number;
  gstAmount: number;
  gstLabel: string;
  grandTotal: number;
  advanceAmount: number;
  due: number;
  payments: ReservationSuccessPayment[];
}

/**
 * §user request — "reservation create karne ke baad ek popup aana chahiye jisme ye details ho,
 * also Advance Receipt ki PDF ban jaye and Booking Voucher ki bhi": a reference app's own
 * success screen as the target — a green checkmark, a details card, and two document buttons.
 * "PDF" here means the same browser-print pattern InvoicePrintView already uses app-wide
 * (window.print → "Save as PDF" in the print dialog), not a new PDF-library dependency.
 */
export function ReservationSuccessModal({ data, onClose }: { data: ReservationSuccessData; onClose: () => void }) {
  const [showReceipt, setShowReceipt] = useState(false);
  const [showVoucher, setShowVoucher] = useState(false);

  const roomLabel = [...new Set(data.rooms.map((r) => r.categoryName))].join(' · ');

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/60 p-4">
      <div className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-800">
        <div className="flex justify-end px-4 pt-4">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-6 text-center">
          <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-50 dark:bg-emerald-500/10">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-600">
              <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7">
                <path d="M5 13l4 4L19 7" />
              </svg>
            </div>
          </div>
          <h3 className="text-xl font-bold text-slate-900 dark:text-white">Reserved Successfully!</h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Booking has been reserved successfully.</p>

          <div className="mt-5 space-y-0 rounded-xl border border-slate-200 text-left dark:border-slate-700">
            <SummaryRow icon="🎫" label="Booking ID">
              <span className="rounded bg-brand-50 px-2 py-0.5 font-mono text-sm font-bold text-brand-700 dark:bg-brand-500/10 dark:text-brand-400">{data.bookingCode}</span>
            </SummaryRow>
            <SummaryRow icon="👤" label="Guest Name">
              <span className="text-sm font-bold text-slate-900 dark:text-white">{data.guestName}</span>
            </SummaryRow>
            <SummaryRow icon="🚪" label="Room">
              <span className="text-sm font-bold text-slate-900 dark:text-white">{roomLabel}</span>
            </SummaryRow>
            <SummaryRow icon="🕐" label="Date & Time">
              <span className="text-sm font-bold text-slate-900 dark:text-white">{formatDateTimeShort(data.createdAt)}</span>
            </SummaryRow>
            <SummaryRow icon="₹" label="Advance Amount" last>
              <span className="text-sm font-bold text-slate-900 dark:text-white">₹{data.advanceAmount.toFixed(2)}</span>
            </SummaryRow>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2.5">
            <Button type="button" onClick={() => setShowReceipt(true)} className="w-full">
              🎫 Advance Receipt
            </Button>
            <Button type="button" variant="secondary" onClick={() => setShowVoucher(true)} className="w-full">
              📋 Booking Voucher
            </Button>
          </div>

          <button type="button" onClick={onClose} className="mt-4 text-sm font-semibold text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
            Close
          </button>
        </div>
      </div>

      {showReceipt && <AdvanceReceiptPrintView data={data} onClose={() => setShowReceipt(false)} />}
      {showVoucher && <BookingVoucherPrintView data={data} onClose={() => setShowVoucher(false)} />}
    </div>,
    document.body,
  );
}

function SummaryRow({ icon, label, children, last }: { icon: string; label: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 px-4 py-3 ${last ? '' : 'border-b border-slate-100 dark:border-slate-700'}`}>
      <span className="flex items-center gap-2.5 text-sm text-slate-500 dark:text-slate-400">
        <span className="text-base">{icon}</span>
        {label}
      </span>
      {children}
    </div>
  );
}
