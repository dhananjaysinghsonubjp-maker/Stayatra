// Mirrors apps/api/src/common/gst.ts — §5.1/§11 GST slabs, for live display only
// (the API is the source of truth on write; this is just so the check-in form
// can show the slab before submitting).
export function computeGstSlab(price: number): { rate: number; label: string } {
  if (price < 1000) return { rate: 0, label: '0%' };
  if (price < 7500) return { rate: 5, label: '5% (no ITC)' };
  return { rate: 18, label: '18% (with ITC)' };
}
