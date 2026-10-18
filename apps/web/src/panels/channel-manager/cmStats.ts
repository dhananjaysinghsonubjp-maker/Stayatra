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

/**
 * §6: "payable to property" — the real bank-account amount for one booking: gross minus
 * commission minus both TDS withholdings (§ user request — a plain commission-only figure
 * here used to disagree with Business Reports'/Unified Ledger's richer per-channel payout for
 * the exact same bookings, which is worse than not showing a number at all). Null (shown as
 * "—") until a commission rate is configured for that connection (Credentials page).
 */
export function payableToProperty(booking: Booking, connections: OtaConnection[]): number | null {
  const connection = connections.find((c) => c.otaCode === booking.source);
  const rate = connection?.commissionRatePercent;
  if (rate == null) return null;
  const gross = Number(booking.totalAmount);
  const commissionAmount = gross * (Number(rate) / 100);
  const ecommerceTds = gross * ECOMMERCE_TDS_RATE;
  const commissionTds = commissionAmount * COMMISSION_TDS_RATE;
  return gross - commissionAmount - ecommerceTds - commissionTds;
}

// Shared with Business Reports and Unified Ledger — one source of truth for the channel
// payout breakdown so the two screens can't quietly drift to different numbers for the
// same booking set.
export const ECOMMERCE_TDS_RATE = 0.001; // Section 194-O, 0.1%
export const COMMISSION_TDS_RATE = 0.02; // Section 393(1), code 1006, 2% — per MASTER_SPEC.md §11

export interface ChannelPayout {
  gross: number;
  commissionAmount: number;
  ecommerceTds: number;
  commissionTds: number;
  /** What actually lands in the property's bank account for this channel's bookings — gross minus commission minus both TDS deductions. */
  netPayout: number;
}

/** The real "amount payable to property" — commission AND both TDS withholdings, not just commission (§ user request: "jo amount payment in bank account hai"). `commissionRatePercent` is a string|number|null straight off OtaConnection, same shape callers already have. */
export function computeChannelPayout(stats: CmStats, commissionRatePercent: string | number | null | undefined): ChannelPayout {
  const commissionRate = commissionRatePercent != null ? Number(commissionRatePercent) : 0;
  const commissionAmount = stats.totalSale * (commissionRate / 100);
  const ecommerceTds = stats.totalSale * ECOMMERCE_TDS_RATE;
  const commissionTds = commissionAmount * COMMISSION_TDS_RATE;
  const netPayout = stats.totalSale - commissionAmount - ecommerceTds - commissionTds;
  return { gross: stats.totalSale, commissionAmount, ecommerceTds, commissionTds, netPayout };
}
