import { useEffect, useRef, useState } from 'react';
import { mutate, query, uploadFile, ApiError } from '../../api';
import { useAuth } from '../../AuthContext';
import { Badge, Button, Card, Field, inputClass } from '../../components/ui';
import { computeInvoiceTotals } from '../../invoice';
import { PAYMENT_METHODS } from '../../paymentMethods';
import type { Booking, InvoiceLineItem, PaymentMethod } from '../../types';

type PaymentMode = 'full' | 'partial' | 'due';

export function InvoiceStep({ bookingId, onClose, onDone }: { bookingId: string; onClose: () => void; onDone: () => void }) {
  const { token } = useAuth();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [lineItems, setLineItems] = useState<InvoiceLineItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // payment
  const [mode, setMode] = useState<PaymentMode>('full');
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [collectedAt, setCollectedAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [referenceNumber, setReferenceNumber] = useState('');
  const [receiptPath, setReceiptPath] = useState<string | undefined>(undefined);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const receiptInputRef = useRef<HTMLInputElement>(null);

  // invoice settings
  const [gstEnabled, setGstEnabled] = useState(true);
  const [discountEnabled, setDiscountEnabled] = useState(false);
  const [discountAmount, setDiscountAmount] = useState(0);

  // add-charge form
  const [addingCharge, setAddingCharge] = useState(false);
  const [chargeDesc, setChargeDesc] = useState('');
  const [chargeQty, setChargeQty] = useState(1);
  const [chargeUnitPrice, setChargeUnitPrice] = useState(0);

  async function refresh() {
    const invoice = await query<{ booking: Booking; lineItems: InvoiceLineItem[] }>('bookings.getInvoice', { bookingId }, token ?? undefined);
    setBooking(invoice.booking);
    setLineItems(invoice.lineItems);
    setGstEnabled(!invoice.booking.gstExempt);
    const d = Number(invoice.booking.discountAmount ?? 0);
    setDiscountEnabled(d > 0);
    setDiscountAmount(d);
  }
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId]);

  const totals = booking
    ? computeInvoiceTotals({
        totalAmount: Number(booking.totalAmount),
        lineItems,
        discountAmount: discountEnabled ? discountAmount : 0,
        gstExempt: !gstEnabled,
      })
    : null;
  const alreadyPaid = Number(booking?.paidAmount ?? 0);
  const outstanding = totals ? totals.grandTotal - alreadyPaid : 0;

  useEffect(() => {
    if (mode === 'full') setAmount(Math.max(0, outstanding));
    else if (mode === 'due') setAmount(0);
    // partial: leave whatever the user typed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, outstanding]);

  async function toggleGst(next: boolean) {
    setGstEnabled(next);
    await mutate('bookings.setInvoiceSettings', { bookingId, gstExempt: !next }, token ?? undefined);
  }

  async function toggleDiscount(next: boolean) {
    setDiscountEnabled(next);
    await mutate('bookings.setInvoiceSettings', { bookingId, discountAmount: next ? discountAmount : null }, token ?? undefined);
  }

  async function saveDiscountAmount(value: number) {
    setDiscountAmount(value);
    if (discountEnabled) await mutate('bookings.setInvoiceSettings', { bookingId, discountAmount: value }, token ?? undefined);
  }

  async function addCharge(e: React.FormEvent) {
    e.preventDefault();
    await mutate('bookings.addLineItem', { bookingId, description: chargeDesc, quantity: chargeQty, unitPrice: chargeUnitPrice }, token ?? undefined);
    setChargeDesc('');
    setChargeQty(1);
    setChargeUnitPrice(0);
    setAddingCharge(false);
    await refresh();
  }

  async function removeCharge(lineItemId: string) {
    await mutate('bookings.removeLineItem', { lineItemId }, token ?? undefined);
    await refresh();
  }

  async function uploadReceipt(file: File) {
    setUploadingReceipt(true);
    try {
      const result = await uploadFile<{ filePath: string }>('uploads/receipt', file, token ?? undefined);
      setReceiptPath(result.filePath);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Receipt upload failed');
    } finally {
      setUploadingReceipt(false);
    }
  }

  async function finish() {
    setError(null);
    setBusy(true);
    try {
      if (mode !== 'due' && amount > 0) {
        await mutate(
          'bookings.addPayment',
          {
            bookingId,
            amount,
            method,
            referenceNumber: referenceNumber || undefined,
            receiptPhotoPath: receiptPath,
            collectedAt: new Date(collectedAt).toISOString(),
          },
          token ?? undefined,
        );
      }
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Payment failed');
    } finally {
      setBusy(false);
    }
  }

  if (!booking || !totals) return <p className="py-8 text-center text-sm text-slate-400">Loading…</p>;

  return (
    <div className="space-y-5">
      {/* Payment */}
      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h5 className="text-sm font-semibold text-slate-900">Payment</h5>
            <p className="text-xs text-slate-500">Collect now or leave as due</p>
          </div>
          <Badge tone={outstanding > 0 ? 'occupied' : 'available'}>Due ₹{outstanding.toFixed(2)}</Badge>
        </div>

        <div className="mb-4 flex rounded-lg bg-slate-100 p-1">
          {(['full', 'partial', 'due'] as PaymentMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`flex-1 rounded-md py-1.5 text-xs font-medium capitalize transition-colors ${mode === m ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
            >
              {m}
            </button>
          ))}
        </div>

        {mode !== 'due' && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-3">
              <Field label="Payment amount (₹)">
                <input
                  className={inputClass}
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(Number(e.target.value))}
                  min={0}
                  max={outstanding}
                  readOnly={mode === 'full'}
                />
              </Field>
              <Field label="Collection date & time">
                <input className={inputClass} type="datetime-local" value={collectedAt} onChange={(e) => setCollectedAt(e.target.value)} />
              </Field>
              <Field label="Reference number">
                <input className={inputClass} value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} placeholder="Optional" />
              </Field>
              <div>
                <p className="mb-1.5 text-xs font-medium text-slate-600">Payment receipt</p>
                <input
                  ref={receiptInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && uploadReceipt(e.target.files[0])}
                />
                <button
                  type="button"
                  onClick={() => receiptInputRef.current?.click()}
                  className="flex w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 py-6 text-xs text-slate-400 hover:border-slate-400"
                >
                  {uploadingReceipt ? 'Uploading…' : receiptPath ? 'Receipt uploaded ✓' : 'Click to upload'}
                </button>
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs font-medium text-slate-600">
                Method <span className="text-red-500">*</span>
              </p>
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
          </div>
        )}
      </Card>

      {/* GST & Discount toggles */}
      <div className="grid grid-cols-2 gap-4">
        <Card className="flex items-center justify-between p-4">
          <span className="text-sm font-medium text-slate-700">GST & Tax</span>
          <Toggle checked={gstEnabled} onChange={toggleGst} />
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700">Discount</span>
            <Toggle checked={discountEnabled} onChange={toggleDiscount} />
          </div>
          {discountEnabled && (
            <input
              className={`${inputClass} mt-3`}
              type="number"
              value={discountAmount}
              onChange={(e) => saveDiscountAmount(Number(e.target.value))}
              min={0}
              placeholder="Discount amount (₹)"
            />
          )}
        </Card>
      </div>

      {/* Invoice */}
      <Card>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <h5 className="text-sm font-semibold text-slate-900">Invoice</h5>
            <Badge tone="slate">Nightly</Badge>
            <Badge tone="slate">1 room</Badge>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <span>{booking.guestName}</span>
            {booking.guestPhone && <span>{booking.guestPhone}</span>}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs font-medium text-slate-500">
                <th className="px-5 py-3">Description</th>
                <th className="px-5 py-3">Qty</th>
                <th className="px-5 py-3">Check-in / Check-out</th>
                <th className="px-5 py-3">Unit price</th>
                <th className="px-5 py-3">Amount</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <tr>
                <td className="px-5 py-3 font-medium text-slate-900">Room charge</td>
                <td className="px-5 py-3">1</td>
                <td className="px-5 py-3 text-slate-500">
                  {booking.checkIn.slice(0, 10)} → {booking.checkOut.slice(0, 10)} ({booking.nights} night{booking.nights === 1 ? '' : 's'})
                </td>
                <td className="px-5 py-3">
                  ₹{(Number(booking.totalAmount) / booking.nights).toFixed(2)} × {booking.nights}
                </td>
                <td className="px-5 py-3 font-medium">₹{Number(booking.totalAmount).toFixed(2)}</td>
                <td></td>
              </tr>
              {lineItems.map((li) => (
                <tr key={li.id}>
                  <td className="px-5 py-3 text-slate-700">{li.description}</td>
                  <td className="px-5 py-3">{li.quantity}</td>
                  <td className="px-5 py-3 text-slate-400">—</td>
                  <td className="px-5 py-3">₹{Number(li.unitPrice).toFixed(2)}</td>
                  <td className="px-5 py-3">₹{Number(li.amount).toFixed(2)}</td>
                  <td className="px-5 py-3 text-right">
                    <button type="button" onClick={() => removeCharge(li.id)} className="text-xs text-red-500 hover:underline">
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="border-t border-slate-100 px-5 py-3">
          {!addingCharge ? (
            <button type="button" onClick={() => setAddingCharge(true)} className="text-xs font-medium text-brand-600 hover:underline">
              + Add Extra Charges
            </button>
          ) : (
            <form onSubmit={addCharge} className="grid grid-cols-4 gap-2">
              <input className={inputClass} placeholder="Description" value={chargeDesc} onChange={(e) => setChargeDesc(e.target.value)} required />
              <input className={inputClass} type="number" placeholder="Qty" value={chargeQty} onChange={(e) => setChargeQty(Number(e.target.value))} min={1} />
              <input
                className={inputClass}
                type="number"
                placeholder="Unit price"
                value={chargeUnitPrice}
                onChange={(e) => setChargeUnitPrice(Number(e.target.value))}
                min={0}
              />
              <div className="flex gap-2">
                <Button type="submit" variant="secondary" className="flex-1">
                  Add
                </Button>
                <Button type="button" variant="ghost" onClick={() => setAddingCharge(false)}>
                  ✕
                </Button>
              </div>
            </form>
          )}
        </div>

        <div className="space-y-1.5 border-t border-slate-100 px-5 py-4 text-sm">
          <div className="flex justify-between text-slate-500">
            <span>Base price</span>
            <span>₹{totals.basePrice.toFixed(2)}</span>
          </div>
          {totals.extraCharges > 0 && (
            <div className="flex justify-between text-slate-500">
              <span>Extra charges</span>
              <span>₹{totals.extraCharges.toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between text-slate-500">
            <span>Subtotal</span>
            <span>₹{totals.subtotal.toFixed(2)}</span>
          </div>
          {totals.discount > 0 && (
            <div className="flex justify-between text-amber-600">
              <span>Discount</span>
              <span>−₹{totals.discount.toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between text-slate-500">
            <span>GST ({totals.gst.label})</span>
            <span>₹{totals.gst.amount.toFixed(2)}</span>
          </div>
          <div className="mt-2 flex justify-between rounded-lg bg-emerald-50 px-3 py-2 text-base font-semibold text-emerald-800">
            <span>Total</span>
            <span>₹{totals.grandTotal.toFixed(2)}</span>
          </div>
        </div>
      </Card>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          Close
        </Button>
        <Button type="button" onClick={finish} disabled={busy}>
          {busy ? 'Saving…' : 'Done'}
        </Button>
      </div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 rounded-full transition-colors ${checked ? 'bg-brand-600' : 'bg-slate-300'}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  );
}
