// Mirrors apps/api/src/common/gst.ts — for live display only (the API is the source of truth on
// write; this is just so the check-in form can show the rate before submitting).
//
// §user request — "GST ko update karo new policy ke hisab se which is 5%": the GST Council's
// 56th meeting (effective 2025-09-22) replaced the old ₹1,000/₹7,500 tariff-slab system (0% /
// 5% no-ITC / 18% with-ITC) with one flat 5% no-ITC rate on hotel accommodation, regardless of
// room price. `price` is kept as a parameter (unused now) so every existing call site keeps
// compiling unchanged.
export function computeGstSlab(_price: number): { rate: number; label: string } {
  return { rate: 5, label: '5% (no ITC)' };
}
