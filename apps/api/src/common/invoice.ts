import { computeGstSlab } from './gst.js';

export interface InvoiceLineItemLike {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export interface InvoiceTotals {
  basePrice: number;
  extraCharges: number;
  subtotal: number; // basePrice + extraCharges, before discount/GST
  discount: number;
  gst: { rate: number; label: string; amount: number };
  grandTotal: number; // what the guest actually owes — use this for "due", never totalAmount alone
}

/**
 * The single source of truth for what a booking actually costs, once extra
 * charges and a discount exist on top of the base room price (§ added beyond
 * MD spec, matching a reference competitor's invoice screen). Every "due"
 * calculation in the app must go through this, not `totalAmount - paidAmount`.
 */
export function computeInvoiceTotals(input: {
  totalAmount: number;
  lineItems: InvoiceLineItemLike[];
  discountAmount?: number | null;
  gstExempt?: boolean;
}): InvoiceTotals {
  const basePrice = input.totalAmount;
  const extraCharges = input.lineItems.reduce((sum, li) => sum + li.amount, 0);
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
