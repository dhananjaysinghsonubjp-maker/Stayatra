// §8.7 — "Delayed: a room past its cleaning deadline (checkout hour + grace
// window on the departure day, floored at check-in + grace so a late check-in
// can't land past its own deadline immediately)."
//
// checkoutHour/graceHours aren't modeled as a per-hotel setting yet — the spec
// doesn't say where they'd be configured, so these are global defaults for now.
// Revisit as a `hotels` column if a real hotel needs a different checkout hour.
export const CHECKOUT_HOUR = 11; // 11:00 AM
export const GRACE_HOURS = 2;

export function computeCleaningDeadline(checkIn: Date, checkOut: Date): Date {
  const onDeparture = new Date(checkOut);
  onDeparture.setHours(CHECKOUT_HOUR + GRACE_HOURS, 0, 0, 0);

  const floor = new Date(checkIn.getTime() + GRACE_HOURS * 60 * 60 * 1000);
  return onDeparture > floor ? onDeparture : floor;
}

export function isDelayed(checkIn: Date, checkOut: Date, delayResolvedAt: Date | null, now = new Date()): boolean {
  if (delayResolvedAt) return false;
  return now > computeCleaningDeadline(checkIn, checkOut);
}
