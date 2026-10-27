import { paymentMethodLabel } from '../paymentMethods';
import { formatDateTimeShort } from '../dateFormat';
import type { PaymentMethod } from '../types';

export interface PaymentHistoryEntry {
  key: string;
  amount: number;
  collectedAt: string;
  method: PaymentMethod;
  referenceNumber?: string | null;
  /** Set only for a group reservation — which room(s) this entry covers, since one "Add Payment"
   * against the whole booking can land as a single collection split across several rooms. */
  roomLabel?: string;
}

/**
 * §user request — "advance lene ke baad phir se payment add karein toh ek bulk amount ho jata
 * hai, payment ka date/time aur receipt proper aana chahiye taki pata chale 1st installment,
 * 2nd, final payment kab hui": every Payment row already carries its own amount/method/
 * collectedAt/referenceNumber — this was just never rendered as its own list anywhere the booking
 * is actually viewed, only ever rolled up into one "Paid: ₹X" total. Numbered oldest-first so
 * "installment 1 / 2 / 3" reads the same way the front desk already thinks about it.
 */
export function PaymentHistory({ entries }: { entries: PaymentHistoryEntry[] }) {
  const sorted = [...entries].sort((a, b) => a.collectedAt.localeCompare(b.collectedAt));
  if (sorted.length === 0) {
    return <p className="px-3 py-3 text-center text-xs text-slate-400 dark:text-slate-500">No payments recorded yet.</p>;
  }
  return (
    <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
      {sorted.map((p, i) => (
        <div key={p.key} className="flex items-start gap-2.5 px-3 py-2.5 text-sm">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-500 dark:bg-slate-700 dark:text-slate-300">
            {i + 1}
          </span>
          <div className="min-w-0">
            <p className="font-medium text-slate-900 dark:text-white">
              ₹{p.amount.toFixed(2)} <span className="font-normal text-slate-400 dark:text-slate-500">· {paymentMethodLabel(p.method)}</span>
            </p>
            <p className="text-xs text-slate-400 dark:text-slate-500">
              {formatDateTimeShort(p.collectedAt)}
              {p.referenceNumber ? ` · Ref: ${p.referenceNumber}` : ''}
              {p.roomLabel ? ` · ${p.roomLabel}` : ''}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
