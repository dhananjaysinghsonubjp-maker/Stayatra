import { useEffect, useRef, useState } from 'react';
import { uploadFile, ApiError } from '../../api';
import { useAuth } from '../../AuthContext';
import { Badge, Button, Card, Field, inputClass } from '../../components/ui';
import { computeInvoiceTotals } from '../../invoice';
import { PAYMENT_METHODS } from '../../paymentMethods';
import type { PaymentMethod } from '../../types';

type PaymentMode = 'full' | 'partial' | 'due';

export interface DraftLineItem {
  key: string;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export interface InvoiceDraft {
  lineItems: DraftLineItem[];
  discountAmount: number | null;
  gstExempt: boolean;
  payment?: { amount: number; method: PaymentMethod; referenceNumber?: string; receiptPhotoPath?: string; collectedAt: string };
}

/**
 * Nothing here touches the server — this is a local draft only. The whole
 * point: closing/going back out of check-in before finishing must leave zero
 * trace (no booking, no occupied room), which wasn't true when this step
 * operated on an already-created booking via live API calls. Everything
 * commits in one shot when the wizard actually finishes (§ — fixes a real
 * "ghost checked-in guest" bug from an abandoned step 2).
 */
export function InvoiceStep({
  guestName,
  guestPhone,
  totalAmount,
  alreadyPaid,
  onBack,
  onClose,
  onComplete,
  busy,
}: {
  guestName: string;
  guestPhone?: string;
  totalAmount: number;
  alreadyPaid: number;
  onBack: () => void;
  onClose: () => void;
  onComplete: (draft: InvoiceDraft) => void;
  busy: boolean;
}) {
  const { token } = useAuth();

  // payment
  const [mode, setMode] = useState<PaymentMode>('full');
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [collectedAt, setCollectedAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [referenceNumber, setReferenceNumber] = useState('');
  const [receiptPath, setReceiptPath] = useState<string | undefined>(undefined);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const receiptInputRef = useRef<HTMLInputElement>(null);

  // invoice settings — local draft only
  const [gstEnabled, setGstEnabled] = useState(true);
  const [discountEnabled, setDiscountEnabled] = useState(false);
  const [discountAmount, setDiscountAmount] = useState(0);
  const [lineItems, setLineItems] = useState<DraftLineItem[]>([]);

  // add-charge form
  const [addingCharge, setAddingCharge] = useState(false);
  const [chargeDesc, setChargeDesc] = useState('');
  const [chargeQty, setChargeQty] = useState(1);
  const [chargeUnitPrice, setChargeUnitPrice] = useState(0);

  const totals = computeInvoiceTotals({
    totalAmount,
    lineItems: lineItems.map((li) => ({ amount: li.amount })),
    discountAmount: discountEnabled ? discountAmount : 0,
    gstExempt: !gstEnabled,
  });
  const outstanding = Math.max(0, totals.grandTotal - alreadyPaid);
  // what's actually left owing once the amount currently entered is applied —
  // this is what should drive the "Due" indicator, not the static outstanding
  // total, otherwise typing a partial amount never visibly does anything.
  const remainingAfterPayment = Math.max(0, outstanding - (mode === 'due' ? 0 : amount));

  useEffect(() => {
    if (mode === 'full') setAmount(outstanding);
    else if (mode === 'due') setAmount(0);
    // partial: leave whatever the user typed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, outstanding]);

  function addCharge(e: React.FormEvent) {
    e.preventDefault();
    setLineItems((prev) => [
      ...prev,
      { key: crypto.randomUUID(), description: chargeDesc, quantity: chargeQty, unitPrice: chargeUnitPrice, amount: chargeQty * chargeUnitPrice },
    ]);
    setChargeDesc('');
    setChargeQty(1);
    setChargeUnitPrice(0);
    setAddingCharge(false);
  }

  function removeCharge(key: string) {
    setLineItems((prev) => prev.filter((li) => li.key !== key));
  }

  async function uploadReceipt(file: File) {
    setUploadingReceipt(true);
    setUploadError(null);
    try {
      const result = await uploadFile<{ filePath: string }>('uploads/receipt', file, token ?? undefined);
      setReceiptPath(result.filePath);
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : 'Receipt upload failed');
    } finally {
      setUploadingReceipt(false);
    }
  }

  function finish() {
    onComplete({
      lineItems,
      discountAmount: discountEnabled ? discountAmount : null,
      gstExempt: !gstEnabled,
      payment:
        mode !== 'due' && amount > 0
          ? { amount, method, referenceNumber: referenceNumber || undefined, receiptPhotoPath: receiptPath, collectedAt: new Date(collectedAt).toISOString() }
          : undefined,
    });
  }

  return (
    <div className="space-y-5">
      {/* Payment */}
      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h5 className="text-sm font-semibold text-slate-900">Payment</h5>
            <p className="text-xs text-slate-500">Collect now or leave as due</p>
          </div>
          <div className="text-right">
            <Badge tone={remainingAfterPayment > 0 ? 'occupied' : 'available'}>
              {mode === 'due' ? 'Due' : 'Due after this payment'} ₹{remainingAfterPayment.toFixed(2)}
            </Badge>
            {mode !== 'due' && amount > 0 && <p className="mt-1 text-xs text-slate-400">Total owed ₹{outstanding.toFixed(2)} − paying ₹{amount.toFixed(2)} now</p>}
          </div>
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
                {uploadError && <p className="mt-1 text-xs text-red-600">{uploadError}</p>}
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
          <Toggle checked={gstEnabled} onChange={setGstEnabled} />
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700">Discount</span>
            <Toggle checked={discountEnabled} onChange={setDiscountEnabled} />
          </div>
          {discountEnabled && (
            <input
              className={`${inputClass} mt-3`}
              type="number"
              value={discountAmount}
              onChange={(e) => setDiscountAmount(Number(e.target.value))}
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
            <span>{guestName}</span>
            {guestPhone && <span>{guestPhone}</span>}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs font-medium text-slate-500">
                <th className="px-5 py-3">Description</th>
                <th className="px-5 py-3">Qty</th>
                <th className="px-5 py-3">Unit price</th>
                <th className="px-5 py-3">Amount</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <tr>
                <td className="px-5 py-3 font-medium text-slate-900">Room charge</td>
                <td className="px-5 py-3">1</td>
                <td className="px-5 py-3">₹{totalAmount.toFixed(2)}</td>
                <td className="px-5 py-3 font-medium">₹{totalAmount.toFixed(2)}</td>
                <td></td>
              </tr>
              {lineItems.map((li) => (
                <tr key={li.key}>
                  <td className="px-5 py-3 text-slate-700">{li.description}</td>
                  <td className="px-5 py-3">{li.quantity}</td>
                  <td className="px-5 py-3">₹{li.unitPrice.toFixed(2)}</td>
                  <td className="px-5 py-3">₹{li.amount.toFixed(2)}</td>
                  <td className="px-5 py-3 text-right">
                    <button type="button" onClick={() => removeCharge(li.key)} className="text-xs text-red-500 hover:underline">
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
          {alreadyPaid > 0 && (
            <div className="flex justify-between text-slate-500">
              <span>Already paid</span>
              <span>₹{alreadyPaid.toFixed(2)}</span>
            </div>
          )}
          {mode !== 'due' && amount > 0 && (
            <div className="flex justify-between text-emerald-600">
              <span>Paying now</span>
              <span>₹{amount.toFixed(2)}</span>
            </div>
          )}
          <div className={`flex justify-between font-medium ${remainingAfterPayment > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
            <span>Due</span>
            <span>{remainingAfterPayment > 0 ? `₹${remainingAfterPayment.toFixed(2)}` : 'Paid in full'}</span>
          </div>
        </div>
      </Card>

      <div className="flex justify-between gap-2">
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={onBack}>
            ← Back
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel check-in
          </Button>
        </div>
        <Button type="button" onClick={finish} disabled={busy}>
          {busy ? 'Completing…' : 'Complete Check-in'}
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
