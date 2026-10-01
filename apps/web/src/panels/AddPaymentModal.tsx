import { useState } from 'react';
import { mutate, ApiError } from '../api';
import { useAuth } from '../AuthContext';
import { Button, Card, Field, inputClass } from '../components/ui';
import { computeInvoiceTotals } from '../invoice';
import { PAYMENT_METHODS } from '../paymentMethods';
import type { Booking, PaymentMethod } from '../types';

export function AddPaymentModal({ booking, onClose, onDone }: { booking: Booking; onClose: () => void; onDone: () => void }) {
  const { token } = useAuth();
  const totals = computeInvoiceTotals({
    totalAmount: Number(booking.totalAmount),
    lineItems: booking.lineItems ?? [],
    discountAmount: booking.discountAmount ? Number(booking.discountAmount) : null,
    gstExempt: booking.gstExempt,
  });
  const outstanding = totals.grandTotal - Number(booking.paidAmount ?? 0);
  const [amount, setAmount] = useState(outstanding);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await mutate('bookings.addPayment', { bookingId: booking.id, amount, method, referenceNumber: referenceNumber || undefined }, token ?? undefined);
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Payment failed');
    }
  }

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-slate-900/40 px-4">
      <Card className="w-full max-w-md p-5">
        <h4 className="mb-1 text-sm font-semibold text-slate-900">Add payment — {booking.guestName}</h4>
        <p className="mb-4 text-xs text-slate-500">Outstanding: ₹{outstanding.toFixed(2)}</p>
        <form onSubmit={submit} className="space-y-3.5">
          <Field label="Amount (₹)">
            <input className={inputClass} type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} min={1} max={outstanding} />
          </Field>
          <Field label="Reference number">
            <input className={inputClass} value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} placeholder="Optional" />
          </Field>
          <div>
            <p className="mb-1.5 text-xs font-medium text-slate-600">Method</p>
            <div className="flex flex-wrap gap-2">
              {PAYMENT_METHODS.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setMethod(m.value)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium ring-1 ring-inset transition-colors ${
                    method === m.value ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-600 ring-slate-300 hover:bg-slate-50'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Record payment</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
