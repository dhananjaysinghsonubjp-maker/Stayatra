import type { Booking, OtaConnection } from '../../types';

export interface CmStats {
  totalSale: number;
  totalNights: number;
  totalBookings: number;
  cancelledBookings: number;
  arr: number; // Average Room Rate — totalSale / totalNights, 0 if no nights
}

/** Cancelled bookings are excluded from Total Sale/Nights/ARR but still counted in Total No of Bookings — matches how the reference product's dashboard tiles read. */
export function computeCmStats(bookings: Booking[]): CmStats {
  const active = bookings.filter((b) => b.status !== 'cancelled');
  const totalSale = active.reduce((sum, b) => sum + Number(b.totalAmount), 0);
  const totalNights = active.reduce((sum, b) => sum + b.nights, 0);
  return {
    totalSale,
    totalNights,
    totalBookings: bookings.length,
    cancelledBookings: bookings.length - active.length,
    arr: totalNights > 0 ? totalSale / totalNights : 0,
  };
}

/** §6: "payable to property" = gross minus the channel's commission % — null (shown as "—") until a commission rate is configured for that connection (Credentials page). */
export function payableToProperty(booking: Booking, connections: OtaConnection[]): number | null {
  const connection = connections.find((c) => c.otaCode === booking.source);
  const rate = connection?.commissionRatePercent;
  if (rate == null) return null;
  return Number(booking.totalAmount) * (1 - Number(rate) / 100);
}
