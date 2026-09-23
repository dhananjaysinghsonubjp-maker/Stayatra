import { computeGstSlab } from './gst';
import type { InvoiceLineItem, InvoiceTotals } from './types';

// Mirrors apps/api/src/common/invoice.ts — every "due"/"total" shown in the
// simulator must go through this, not a raw totalAmount - paidAmount, now
// that extra charges and discounts exist on top of the base room price.
export function computeInvoiceTotals(input: {
  totalAmount: number;
  lineItems: Pick<InvoiceLineItem, 'amount'>[];
  discountAmount?: number | null;
  gstExempt?: boolean;
}): InvoiceTotals {
  const basePrice = input.totalAmount;
  const extraCharges = input.lineItems.reduce((sum, li) => sum + Number(li.amount), 0);
  const subtotal = basePrice + extraCharges;
  const discount = Math.min(input.discountAmount ?? 0, subtotal);
  const taxableAmount = subtotal - discount;

  const slab = input.gstExempt ? { rate: 0, label: '0% (exempt)' } : computeGstSlab(taxableAmount);
  const gstAmount = Math.round((taxableAmount * slab.rate) / 100);

  return {
    basePrice,
    extraCharges,
    subtotal,
    discount,
    gst: { rate: slab.rate, label: slab.label, amount: gstAmount },
    grandTotal: taxableAmount + gstAmount,
  };
}
