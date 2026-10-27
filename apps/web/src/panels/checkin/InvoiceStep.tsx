import { useEffect, useMemo, useRef, useState } from 'react';
import { uploadFile, ApiError } from '../../api';
import { useAuth } from '../../AuthContext';
import { Badge, Button, Card, Field, royalInputClass as inputClass } from '../../components/ui';
import { computeGstSlab } from '../../gst';
import { computeInvoiceTotals } from '../../invoice';
import { PAYMENT_METHODS } from '../../paymentMethods';
import type { PaymentMethod } from '../../types';
import { CameraCapture } from './CameraCapture';

// §user request — "Mode of Payment" ek proper header ke saath, dropdown mein icon + short
// description dikhe (reference: RoomNexa's payment-mode picker). Local to this screen only —
// the shared PAYMENT_METHODS list elsewhere (Reports/Ledger/etc.) stays a plain pill/label list.
const PAYMENT_METHOD_INFO: Record<PaymentMethod, { icon: string; description: string }> = {
  online: { icon: '🌐', description: 'Pay via payment gateway or link' },
  cash: { icon: '💵', description: 'Collect the amount in cash' },
  card: { icon: '💳', description: 'Card swipe via POS terminal' },
  bank_transfer: { icon: '🏦', description: 'Paid directly to the bank account' },
  company_settlement: { icon: '🏢', description: 'Billed to a company account' },
  agent_settlement: { icon: '🤝', description: 'Settled via a travel agent' },
  upi: { icon: '📲', description: 'Pay instantly using a UPI app' },
  credit_sale: { icon: '📝', description: 'Payment deferred, billed later' },
  cheque: { icon: '🧾', description: 'Paid by cheque' },
  cash_deposit: { icon: '🏧', description: 'Deposited directly in the bank' },
};

type PaymentMode = 'full' | 'partial' | 'due';
type GstMode = 'exclusive' | 'inclusive' | 'exempt';
type DiscountType = 'flat' | 'percent';

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
  /**
   * Only set when GST mode is "inclusive" — the room charge the guest agreed
   * to already includes tax, so this is the backed-out pre-tax base (what
   * every other screen's `computeInvoiceTotals` call expects `totalAmount` to
   * be). Callers should send this instead of their own pre-tax figure when present.
   */
  adjustedTotalAmount?: number;
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
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showReceiptCamera, setShowReceiptCamera] = useState(false);
  const receiptInputRef = useRef<HTMLInputElement>(null);

  // §user request — "upload hone ke baad picture bani aani chahiye": show a thumbnail the
  // instant a file is picked/captured, not only once the server upload finishes.
  const receiptPreview = useMemo(() => (receiptFile ? URL.createObjectURL(receiptFile) : null), [receiptFile]);
  useEffect(() => {
    return () => {
      if (receiptPreview) URL.revokeObjectURL(receiptPreview);
    };
  }, [receiptPreview]);

  // invoice settings — local draft only
  const [gstMode, setGstMode] = useState<GstMode>('exclusive');
  const [discountEnabled, setDiscountEnabled] = useState(false);
  const [discountType, setDiscountType] = useState<DiscountType>('flat');
  // '' rather than 0 so the field starts genuinely empty — a real 0 renders as
  // an opaque "0", indistinguishable from an intentional entry, whereas an
  // empty value lets the placeholder show through at its normal low opacity
  // as a hint of what to fill in.
  const [discountAmount, setDiscountAmount] = useState<number | ''>('');
  const [discountPercent, setDiscountPercent] = useState(10);
  const [lineItems, setLineItems] = useState<DraftLineItem[]>([]);

  // add-charge form — same empty-by-default reasoning as discountAmount above
  const [addingCharge, setAddingCharge] = useState(false);
  const [chargeDesc, setChargeDesc] = useState('');
  const [chargeQty, setChargeQty] = useState<number | ''>('');
  const [chargeUnitPrice, setChargeUnitPrice] = useState<number | ''>('');

  const extraChargesSum = lineItems.reduce((sum, li) => sum + li.amount, 0);
  // "Inclusive" means the room rate the guest agreed to already has GST baked
  // in, so the pre-tax base every other screen's computeInvoiceTotals expects
  // has to be backed out first — everything downstream still adds GST back on
  // top of this, reconstructing the same grand total the guest was quoted.
  const inclusiveRate = computeGstSlab(totalAmount).rate;
  const effectiveTotalAmount =
    gstMode === 'inclusive' ? Math.round((totalAmount / (1 + inclusiveRate / 100)) * 100) / 100 : totalAmount;
  const discountBase = effectiveTotalAmount + extraChargesSum;
  const effectiveDiscountAmount = discountEnabled
    ? discountType === 'percent'
      ? Math.round(((discountPercent / 100) * discountBase + Number.EPSILON) * 100) / 100
      : Number(discountAmount) || 0
    : 0;
  const discountActive = discountEnabled && effectiveDiscountAmount > 0;

  const totals = computeInvoiceTotals({
    totalAmount: effectiveTotalAmount,
    lineItems: lineItems.map((li) => ({ amount: li.amount })),
    discountAmount: effectiveDiscountAmount,
    gstExempt: gstMode === 'exempt',
  });
  const outstanding = Math.max(0, totals.grandTotal - alreadyPaid);
  // what's actually left owing once the amount currently entered is applied —
  // this is what should drive the "Due" indicator, not the static outstanding
  // total, otherwise typing a partial amount never visibly does anything.
  const remainingAfterPayment = Math.max(0, outstanding - (mode === 'due' ? 0 : amount));

  useEffect(() => {
    if (mode === 'full') setAmount(Math.round(outstanding * 100) / 100);
    else if (mode === 'due') setAmount(0);
    // partial: leave whatever the user typed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, outstanding]);

  function addCharge(e: React.FormEvent) {
    e.preventDefault();
    const quantity = Number(chargeQty) || 1;
    const unitPrice = Number(chargeUnitPrice) || 0;
    setLineItems((prev) => [...prev, { key: crypto.randomUUID(), description: chargeDesc, quantity, unitPrice, amount: quantity * unitPrice }]);
    setChargeDesc('');
    setChargeQty('');
    setChargeUnitPrice('');
    setAddingCharge(false);
  }

  function removeCharge(key: string) {
    setLineItems((prev) => prev.filter((li) => li.key !== key));
  }

  async function uploadReceipt(file: File) {
    setReceiptFile(file);
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
      discountAmount: discountEnabled ? effectiveDiscountAmount : null,
      gstExempt: gstMode === 'exempt',
      adjustedTotalAmount: gstMode === 'inclusive' ? effectiveTotalAmount : undefined,
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
          <div className="space-y-4">
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

            <div>
              <p className="mb-1.5 text-xs font-medium text-slate-600">
                Mode of Payment <span className="text-red-500">*</span>
              </p>
              <MethodPicker value={method} onChange={setMethod} />
            </div>

            <Field label="Reference number">
              <input
                className={inputClass}
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
                placeholder="Optional — UPI ref, cheque no., etc."
              />
            </Field>

            <Field label="Collection date & time">
              <input className={inputClass} type="datetime-local" value={collectedAt} onChange={(e) => setCollectedAt(e.target.value)} />
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
              <ReceiptSlot
                previewUrl={receiptPreview}
                uploading={uploadingReceipt}
                onUpload={() => receiptInputRef.current?.click()}
                onCamera={() => setShowReceiptCamera(true)}
                onRemove={() => {
                  setReceiptFile(null);
                  setReceiptPath(undefined);
                }}
              />
              {uploadError && <p className="mt-1 text-xs text-red-600">{uploadError}</p>}
            </div>
          </div>
        )}
      </Card>

      {showReceiptCamera && (
        <CameraCapture
          onCapture={(file) => {
            uploadReceipt(file);
            setShowReceiptCamera(false);
          }}
          onClose={() => setShowReceiptCamera(false)}
        />
      )}

      {/* GST & Discount */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card className="p-4">
          <div className="mb-3 flex items-center gap-2.5">
            <IconBadge><ReceiptIcon /></IconBadge>
            <span className="text-sm font-medium text-slate-700">GST & Tax</span>
          </div>
          <div className="flex rounded-lg bg-slate-100 p-1">
            {(['exclusive', 'inclusive', 'exempt'] as GstMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setGstMode(m)}
                className={`flex-1 rounded-md py-1.5 text-xs font-semibold capitalize transition-colors ${
                  gstMode === m ? 'bg-royal-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-500">
            {gstMode === 'exempt' ? (
              'No GST applied to this stay'
            ) : (
              <>
                <span className="rounded-full bg-royal-50 px-2 py-1 font-semibold text-royal-700">{totals.gst.rate}% GST</span>{' '}
                {gstMode === 'inclusive' ? 'already included in the room rate' : 'added on top of the room rate'}
              </>
            )}
          </p>
        </Card>

        <Card className={`p-4 transition-colors ${discountActive ? 'border-royal-200 bg-gradient-to-br from-royal-50/70 to-white' : ''}`}>
          <div className="mb-3 flex items-center justify-between pr-2">
            <div className="flex items-center gap-2.5">
              <IconBadge active={discountActive}>
                <TagIcon />
              </IconBadge>
              <span className="text-sm font-medium text-slate-700">Discount</span>
            </div>
            {/* The switch's on/off look reflects whether a discount is actually
                applied right now (a real nonzero amount), not just whether the
                picker below is open — so it stays at the left until a value is
                actually entered, not the moment the panel is revealed. */}
            <Toggle checked={discountActive} onChange={setDiscountEnabled} />
          </div>
          {discountEnabled && (
            <>
              <div className="mb-3 flex rounded-lg bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => setDiscountType('percent')}
                  className={`flex-1 rounded-md py-1.5 text-xs font-semibold transition-colors ${
                    discountType === 'percent' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                  }`}
                >
                  %
                </button>
                <button
                  type="button"
                  onClick={() => setDiscountType('flat')}
                  className={`flex-1 rounded-md py-1.5 text-xs font-semibold transition-colors ${
                    discountType === 'flat' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                  }`}
                >
                  ₹
                </button>
              </div>
              {discountType === 'percent' ? (
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={discountPercent}
                    onChange={(e) => setDiscountPercent(Number(e.target.value))}
                    className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-royal-100 accent-royal-600"
                  />
                  <span className="rounded-full bg-royal-600 px-2.5 py-1 text-xs font-semibold text-white">{discountPercent}%</span>
                </div>
              ) : (
                <input
                  className={inputClass}
                  type="number"
                  value={discountAmount}
                  onChange={(e) => setDiscountAmount(e.target.value === '' ? '' : Number(e.target.value))}
                  min={0}
                  placeholder="Discount amount (₹)"
                />
              )}
              <p className="mt-2 text-xs text-slate-500">
                Discount amount: <span className="font-semibold text-amber-600">−₹{effectiveDiscountAmount.toFixed(2)}</span>
              </p>
            </>
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
                <td className="px-5 py-3 font-medium text-slate-900">
                  Room charge
                  {gstMode === 'inclusive' && <span className="ml-1.5 text-xs font-normal text-slate-400">(GST-inclusive rate: ₹{totalAmount.toFixed(2)})</span>}
                </td>
                <td className="px-5 py-3">1</td>
                <td className="px-5 py-3">₹{totals.basePrice.toFixed(2)}</td>
                <td className="px-5 py-3 font-medium">₹{totals.basePrice.toFixed(2)}</td>
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
            <button type="button" onClick={() => setAddingCharge(true)} className="text-xs font-medium text-royal-600 hover:underline">
              + Add Extra Charges
            </button>
          ) : (
            <form onSubmit={addCharge} className="grid grid-cols-4 gap-2">
              <input className={inputClass} placeholder="Description" value={chargeDesc} onChange={(e) => setChargeDesc(e.target.value)} required />
              <input
                className={inputClass}
                type="number"
                placeholder="1"
                value={chargeQty}
                onChange={(e) => setChargeQty(e.target.value === '' ? '' : Number(e.target.value))}
                min={1}
              />
              <input
                className={inputClass}
                type="number"
                placeholder="0.00"
                value={chargeUnitPrice}
                onChange={(e) => setChargeUnitPrice(e.target.value === '' ? '' : Number(e.target.value))}
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
            <span>
              GST <span className="text-slate-400">({totals.gst.rate}%{gstMode === 'inclusive' ? ' · included' : ''})</span>
            </span>
            <span>₹{totals.gst.amount.toFixed(2)}</span>
          </div>
          <div className="mt-2 flex justify-between rounded-lg bg-royal-50 px-3 py-2 text-base font-semibold text-royal-800">
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
            <div className="mt-2 flex justify-between rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">
              <span>Paying now</span>
              <span>₹{amount.toFixed(2)}</span>
            </div>
          )}
          <div
            className={`mt-2 flex justify-between rounded-lg px-3 py-2 text-base font-bold ${
              remainingAfterPayment > 0 ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'
            }`}
          >
            <span>Due</span>
            <span>{remainingAfterPayment > 0 ? `₹${remainingAfterPayment.toFixed(2)}` : 'Paid in full ✓'}</span>
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
        <Button type="button" variant="royal" onClick={finish} disabled={busy}>
          {busy ? 'Completing…' : 'Complete Check-in'}
        </Button>
      </div>
    </div>
  );
}

// §user request — "upi cash vagera ko proper header 'Mode of Payment' ke saath, click karte hi
// dropdown khule" (reference: RoomNexa's icon + bold label + description + radio picker).
function MethodPicker({ value, onChange }: { value: PaymentMethod; onChange: (m: PaymentMethod) => void }) {
  const [open, setOpen] = useState(false);
  const selected = PAYMENT_METHODS.find((m) => m.value === value);
  const selectedInfo = PAYMENT_METHOD_INFO[value];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`${inputClass} flex w-full items-center justify-between gap-2 text-left`}
      >
        <span className="flex items-center gap-2">
          <span className="text-base">{selectedInfo.icon}</span>
          <span className="font-medium text-slate-900">{selected?.label}</span>
        </span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1.5 max-h-72 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
            {PAYMENT_METHODS.map((m) => {
              const info = PAYMENT_METHOD_INFO[m.value];
              const isSelected = m.value === value;
              return (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => {
                    onChange(m.value);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                    isSelected ? 'bg-emerald-50' : 'hover:bg-slate-50'
                  }`}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-base">{info.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-slate-900">{m.label}</span>
                    <span className="block text-xs text-slate-500">{info.description}</span>
                  </span>
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                      isSelected ? 'border-emerald-500' : 'border-slate-300'
                    }`}
                  >
                    {isSelected && <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// Same upload+camera+preview pattern as the ID-scan slots in CheckInModal, scoped here for the
// payment receipt. §user request — "photos upload bhi ho sake aur real-time image bhi click kar
// sake" applies to the receipt too, not just guest ID.
function ReceiptSlot({
  previewUrl,
  uploading,
  onUpload,
  onCamera,
  onRemove,
}: {
  previewUrl: string | null;
  uploading: boolean;
  onUpload: () => void;
  onCamera: () => void;
  onRemove: () => void;
}) {
  if (previewUrl) {
    return (
      <div className="relative overflow-hidden rounded-lg border border-slate-300">
        <img src={previewUrl} alt="Payment receipt" className="h-32 w-full object-cover" />
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/60 px-2 py-1.5">
          <span className="text-xs font-semibold text-white">{uploading ? 'Uploading…' : 'Receipt uploaded ✓'}</span>
          <button type="button" onClick={onRemove} className="text-xs font-semibold text-white underline">
            Replace
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-2">
      <button
        type="button"
        onClick={onUpload}
        className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 py-5 text-xs font-medium text-slate-500 hover:border-royal-400 hover:text-royal-600"
      >
        <span className="text-lg">📁</span>
        Upload
      </button>
      <button
        type="button"
        onClick={onCamera}
        className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 py-5 text-xs font-medium text-slate-500 hover:border-royal-400 hover:text-royal-600"
      >
        <span className="text-lg">📷</span>
        Camera
      </button>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 rounded-full transition-colors ${checked ? 'bg-royal-600' : 'bg-slate-300'}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  );
}

function IconBadge({ children, active = true }: { children: React.ReactNode; active?: boolean }) {
  return (
    <div
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors ${
        active ? 'bg-royal-100 text-royal-700' : 'bg-slate-100 text-slate-400'
      }`}
    >
      {children}
    </div>
  );
}

function ReceiptIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2h12a1 1 0 0 1 1 1v18l-3-2-2 2-2-2-2 2-2-2-3 2V3a1 1 0 0 1 1-1z" />
      <line x1="9" y1="7" x2="15" y2="7" />
      <line x1="9" y1="11" x2="15" y2="11" />
    </svg>
  );
}

function TagIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.59 2.59a2 2 0 0 0-1.42-.59H4a2 2 0 0 0-2 2v7.17a2 2 0 0 0 .59 1.41l8 8a2 2 0 0 0 2.82 0l7.17-7.17a2 2 0 0 0 0-2.82l-8-8z" />
      <circle cx="7" cy="7" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}
