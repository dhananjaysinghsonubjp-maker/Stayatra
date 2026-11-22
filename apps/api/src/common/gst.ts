// §5.1 / §11: computed at read/write time from the actual sale price, never stored statically.
export interface GstSlab {
  rate: number;
  itcEligible: boolean;
  label: string;
}

// §user request — "GST ko update karo new policy ke hisab se which is 5%": the GST Council's
// 56th meeting (effective 2025-09-22) replaced the old ₹1,000/₹7,500 tariff-slab system (0% /
// 5% no-ITC / 18% with-ITC) with one flat 5% no-ITC rate on hotel accommodation, regardless of
// room price. `price` is kept as a parameter (unused now) so every existing call site — which
// all pass a room's price to pick a slab — keeps compiling unchanged.
export function computeGstSlab(_price: number): GstSlab {
  return { rate: 5, itcEligible: false, label: '5% (no ITC)' };
}
