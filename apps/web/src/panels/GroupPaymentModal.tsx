import { useState } from 'react';
import { mutate, ApiError } from '../api';
import { useAuth } from '../AuthContext';
import { Button, Card, Field, inputClass } from '../components/ui';
import { PAYMENT_METHODS } from '../paymentMethods';
import type { PaymentMethod } from '../types';

/**
 * §user request — "Neeraj ji room-wise payment nahi karte, ek hi baar poori booking ki karte
 * hain": one payment against the whole group reservation (e.g. ₹10,000 advance, ₹10,000 at
 * checkout) instead of staff manually deciding how much lands on which room. The server splits
 * it across rooms by their own outstanding due — this modal only ever shows/collects the group's
 * one total, same spirit as AddPaymentModal but scoped to a reservationGroupId, not one bookingId.
 */
export function GroupPaymentModal({
  reservationGroupId,
  bookerName,
  due,
  onClose,
  onDone,
}: {
  reservationGroupId: string;
  bookerName: string;
  due: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const { token } = useAuth();
  const [amount, setAmount] = useState(due);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await mutate('bookings.addGroupPayment', { reservationGroupId, amount, method, referenceNumber: referenceNumber || undefined }, token ?? undefined);
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Payment failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 px-4">
      <Card className="w-full max-w-md p-5">
        <h4 className="mb-1 text-sm font-semibold text-slate-900 dark:text-white">Add payment — {bookerName}</h4>
        <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
          Outstanding for this whole booking: ₹{due.toFixed(2)} — split automatically across its rooms.
        </p>
        <form onSubmit={submit} className="space-y-3.5">
          <Field label="Amount (₹)">
            <input className={inputClass} type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} min={1} max={due} />
          </Field>
          <Field label="Reference number">
            <input className={inputClass} value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} placeholder="Optional" />
          </Field>
          <div>
            <p className="mb-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">Method</p>
            <div className="flex flex-wrap gap-2">
              {PAYMENT_METHODS.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setMethod(m.value)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium ring-1 ring-inset transition-colors ${
                    method === m.value
                      ? 'bg-brand-600 text-white ring-brand-600'
                      : 'bg-white text-slate-600 ring-slate-300 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-600'
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
            <Button type="submit" disabled={busy}>
              {busy ? 'Recording…' : 'Record payment'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
