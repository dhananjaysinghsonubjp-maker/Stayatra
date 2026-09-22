// §5.1 / §11: computed at read/write time from the actual sale price, never stored statically.
export interface GstSlab {
  rate: number;
  itcEligible: boolean;
  label: string;
}

export function computeGstSlab(price: number): GstSlab {
  if (price < 1000) return { rate: 0, itcEligible: false, label: '0%' };
  if (price < 7500) return { rate: 5, itcEligible: false, label: '5% (no ITC)' };
  return { rate: 18, itcEligible: true, label: '18% (with ITC)' };
}
