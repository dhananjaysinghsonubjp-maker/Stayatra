import { Injectable } from '@nestjs/common';
import type { PaymentMethod } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { computeInvoiceTotals } from '../common/invoice.js';

function dayKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

function endOfDay(d: Date): Date {
  // Must match dayKey's UTC-based bucketing. `d` arrives as a UTC-midnight
  // Date (parsed from a "YYYY-MM-DD" string) — using local setHours() here
  // shifted the boundary by the server's UTC offset (e.g. -5:30 on an
  // IST-hosted server, which is exactly where this is meant to run per §3),
  // silently dropping evening activity from "today"'s report bucket.
  const end = new Date(d);
  end.setUTCHours(23, 59, 59, 999);
  return end;
}

export type MethodBreakdown = Partial<Record<PaymentMethod, number>>;

function addToMethod(breakdown: MethodBreakdown, method: PaymentMethod, amount: number) {
  breakdown[method] = (breakdown[method] ?? 0) + amount;
}

export interface RoomsReportDay {
  date: string;
  checkIns: number;
  cleanings: number;
  guestCleanings: number;
  checkouts: number;
  discrepancies: number;
  delaysResolved: number;
  methods: MethodBreakdown;
}

export interface RoomsReportRoomRow {
  roomId: string;
  roomNumber: string;
  checkIns: number;
  cleanings: number;
  discrepancies: number;
}

export interface SaleReportDay {
  date: string;
  methods: MethodBreakdown;
  due: number;
  totalSale: number;
  bookings: { id: string; guestName: string; roomNumber: string | null; grandTotal: number; paidAmount: number; due: number }[];
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * §8.8 Rooms Report — check-ins, cleanings, guest cleanings, checkouts,
   * delays, discrepancies, collections by method (dynamic — §, expanded beyond
   * the MD spec's implied cash/online/card to the full method list), daily
   * breakdown, per-room rows. "Automatic checkouts" in the spec's language
   * are, in this product, every Checkout Cleaning (§8.6 — the only checkout
   * path there is).
   */
  async getRoomsReport(input: { hotelId: string; from: Date; to: Date }) {
    // `to` arrives as a calendar-day boundary (midnight) — treat it as inclusive
    // of that whole day, otherwise a report run for "today" misses everything
    // that happened after midnight today.
    const toInclusive = endOfDay(input.to);
    const rangeWhere = { gte: input.from, lte: toInclusive };

    const [bookings, cleanings, payments, rooms, resolvedDelays] = await Promise.all([
      this.prisma.booking.findMany({ where: { hotelId: input.hotelId, checkIn: rangeWhere } }),
      this.prisma.cleaningRecord.findMany({ where: { hotelId: input.hotelId, createdAt: rangeWhere } }),
      this.prisma.payment.findMany({ where: { booking: { hotelId: input.hotelId }, collectedAt: rangeWhere } }),
      this.prisma.room.findMany({ where: { hotelId: input.hotelId }, orderBy: { roomNumber: 'asc' } }),
      this.prisma.booking.findMany({ where: { hotelId: input.hotelId, delayResolvedAt: rangeWhere } }),
    ]);

    const days = new Map<string, RoomsReportDay>();
    const dayRow = (key: string): RoomsReportDay => {
      let row = days.get(key);
      if (!row) {
        row = { date: key, checkIns: 0, cleanings: 0, guestCleanings: 0, checkouts: 0, discrepancies: 0, delaysResolved: 0, methods: {} };
        days.set(key, row);
      }
      return row;
    };

    for (const b of bookings) dayRow(dayKey(b.checkIn)).checkIns++;
    for (const c of cleanings) {
      const row = dayRow(dayKey(c.createdAt));
      row.cleanings++;
      if (c.kind === 'guest_stay') row.guestCleanings++;
      if (c.kind === 'checkout') row.checkouts++;
      if (c.flagged) row.discrepancies++;
    }
    for (const p of payments) {
      addToMethod(dayRow(dayKey(p.collectedAt)).methods, p.method, Number(p.amount));
    }
    for (const d of resolvedDelays) dayRow(dayKey(d.delayResolvedAt!)).delaysResolved++;

    const perRoom: RoomsReportRoomRow[] = rooms.map((r) => ({
      roomId: r.id,
      roomNumber: r.roomNumber,
      checkIns: bookings.filter((b) => b.assignedRoomId === r.id).length,
      cleanings: cleanings.filter((c) => c.roomId === r.id).length,
      discrepancies: cleanings.filter((c) => c.roomId === r.id && c.flagged).length,
    }));

    return {
      days: Array.from(days.values()).sort((a, b) => a.date.localeCompare(b.date)),
      rooms: perRoom,
    };
  }

  /**
   * §8.8 Sale Report — total sale split by payment method (dynamic) + Due,
   * one line per day expanding to room-wise bookings. Revenue counts per
   * booking on its check-in day, never per night (§8.8) — a stay spanning a
   * month boundary is counted once, in the month it checked in. "Due" and
   * "total sale" both go through computeInvoiceTotals so extra charges and
   * discounts (§ added beyond MD spec) are reflected correctly, not just the
   * base room price.
   */
  async getSaleReport(input: { hotelId: string; month: string }) {
    const start = new Date(`${input.month}-01T00:00:00.000Z`);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);

    const bookings = await this.prisma.booking.findMany({
      where: { hotelId: input.hotelId, checkIn: { gte: start, lt: end }, status: { not: 'cancelled' } },
      include: { payments: true, assignedRoom: true, lineItems: true },
      orderBy: { checkIn: 'asc' },
    });

    const days = new Map<string, SaleReportDay>();
    for (const b of bookings) {
      const key = dayKey(b.checkIn);
      let row = days.get(key);
      if (!row) {
        row = { date: key, methods: {}, due: 0, totalSale: 0, bookings: [] };
        days.set(key, row);
      }

      for (const p of b.payments) addToMethod(row.methods, p.method, Number(p.amount));

      const paid = Number(b.paidAmount ?? 0);
      const { grandTotal } = computeInvoiceTotals({
        totalAmount: Number(b.totalAmount),
        lineItems: b.lineItems.map((li) => ({ ...li, unitPrice: Number(li.unitPrice), amount: Number(li.amount) })),
        discountAmount: b.discountAmount ? Number(b.discountAmount) : null,
        gstExempt: b.gstExempt,
      });
      const due = grandTotal - paid;

      row.due += due;
      row.totalSale += grandTotal;
      row.bookings.push({
        id: b.id,
        guestName: b.guestName,
        roomNumber: b.assignedRoom?.roomNumber ?? null,
        grandTotal,
        paidAmount: paid,
        due,
      });
    }

    return Array.from(days.values()).sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * §user request, with a reference app's own "Reservation Reports" section as the target — one
   * shared query behind the Master Report (every booking, every filter) and its narrower
   * siblings (Completed/Cancelled/No-Show status views, Arrivals/Departures date views): each
   * just calls this with a different default status list or date field, so there's one place that
   * actually reads the Booking table instead of six near-duplicates.
   */
  async getReservationReport(input: {
    hotelId: string;
    statuses?: ('confirmed' | 'checked_in' | 'checked_out' | 'cancelled' | 'no_show' | 'void')[];
    checkInFrom?: Date;
    checkInTo?: Date;
    checkOutFrom?: Date;
    checkOutTo?: Date;
    reservationFrom?: Date;
    reservationTo?: Date;
    search?: string;
    source?: string;
  }) {
    const where: Record<string, unknown> = { hotelId: input.hotelId };
    if (input.statuses?.length) where.status = { in: input.statuses };
    if (input.source) where.source = input.source;
    if (input.checkInFrom || input.checkInTo) {
      where.checkIn = { gte: input.checkInFrom, lte: input.checkInTo ? endOfDay(input.checkInTo) : undefined };
    }
    if (input.checkOutFrom || input.checkOutTo) {
      where.checkOut = { gte: input.checkOutFrom, lte: input.checkOutTo ? endOfDay(input.checkOutTo) : undefined };
    }
    if (input.reservationFrom || input.reservationTo) {
      where.createdAt = { gte: input.reservationFrom, lte: input.reservationTo ? endOfDay(input.reservationTo) : undefined };
    }
    if (input.search?.trim()) {
      // A booking code on screen is "BK-" + the id's last 6 chars, uppercased — strip that prefix
      // back off and match it against the tail of the real id, alongside a plain guest-name search.
      const needle = input.search.trim().replace(/^bk-?/i, '').toLowerCase();
      where.OR = [{ guestName: { contains: input.search.trim(), mode: 'insensitive' } }, { id: { endsWith: needle } }];
    }

    const rows = await this.prisma.booking.findMany({
      where,
      include: { assignedRoom: { include: { roomCategory: true } }, lineItems: true },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map((b) => {
      const totals = computeInvoiceTotals({
        totalAmount: Number(b.totalAmount),
        lineItems: b.lineItems.map((li) => ({ ...li, unitPrice: Number(li.unitPrice), amount: Number(li.amount) })),
        discountAmount: b.discountAmount ? Number(b.discountAmount) : null,
        gstExempt: b.gstExempt,
      });
      return {
        id: b.id,
        bookingCode: `BK-${b.id.slice(-6).toUpperCase()}`,
        reservationDate: b.createdAt.toISOString(),
        guestName: b.guestName,
        guestPhone: b.guestPhone,
        checkIn: b.checkIn.toISOString(),
        checkOut: b.checkOut.toISOString(),
        source: b.source,
        roomNumber: b.assignedRoom?.roomNumber ?? null,
        roomCategoryName: b.assignedRoom?.roomCategory?.name ?? null,
        status: b.status,
        amount: totals.grandTotal,
        paidAmount: Number(b.paidAmount ?? 0),
      };
    });
  }

  /**
   * §user request, with a reference app's own "Police Report" as the target — the daily
   * guest-occupancy list Indian hotels submit to local police: name, address, phone, room,
   * stay dates, ID type/number, for everyone in-house at any point during the selected range
   * (not just new arrivals that day) — a stay that started before `from` and is still going
   * must still show up. Scoped to checked_in/checked_out since a merely confirmed reservation
   * has no ID captured yet.
   */
  async getPoliceReport(input: { hotelId: string; from: Date; to: Date }) {
    const toInclusive = endOfDay(input.to);
    const rows = await this.prisma.booking.findMany({
      where: {
        hotelId: input.hotelId,
        status: { in: ['checked_in', 'checked_out'] },
        checkIn: { lte: toInclusive },
        checkOut: { gte: input.from },
      },
      include: { assignedRoom: true, guest: true },
      orderBy: { checkIn: 'asc' },
    });
    return rows.map((b) => ({
      id: b.id,
      guestName: b.guestName,
      address: b.guest ? [b.guest.address, b.guest.city, b.guest.state, b.guest.pincode].filter(Boolean).join(', ') : '',
      phone: b.guestPhone ?? '',
      adults: b.adults ?? 1,
      children: b.children ?? 0,
      roomNumber: b.assignedRoom?.roomNumber ?? '—',
      checkIn: b.checkIn.toISOString(),
      checkOut: b.checkOut.toISOString(),
      idType: b.idType,
      idNumber: b.idNumber,
    }));
  }

  /**
   * §user request, with a reference app's own "Day Wise Booking Report" as the target — bookings
   * and revenue by check-in day (same convention this app's own Sale Report already uses:
   * "revenue counted on check-in day, never per night").
   */
  async getDayWiseBookingReport(input: { hotelId: string; from: Date; to: Date }) {
    const toInclusive = endOfDay(input.to);
    const rows = await this.prisma.booking.findMany({
      where: {
        hotelId: input.hotelId,
        checkIn: { gte: input.from, lte: toInclusive },
        status: { not: 'void' },
      },
      include: { lineItems: true },
    });
    const byDay = new Map<string, { bookings: number; amount: number }>();
    for (const b of rows) {
      const totals = computeInvoiceTotals({
        totalAmount: Number(b.totalAmount),
        lineItems: b.lineItems.map((li) => ({ ...li, unitPrice: Number(li.unitPrice), amount: Number(li.amount) })),
        discountAmount: b.discountAmount ? Number(b.discountAmount) : null,
        gstExempt: b.gstExempt,
      });
      const key = dayKey(b.checkIn);
      const entry = byDay.get(key) ?? { bookings: 0, amount: 0 };
      entry.bookings += 1;
      entry.amount += totals.grandTotal;
      byDay.set(key, entry);
    }
    return [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, { bookings, amount }]) => ({ date, bookings, totalAmount: amount, averageAmount: bookings > 0 ? amount / bookings : 0 }));
  }

  /**
   * §user request, with a reference app's own "Check-In and Check-Out Report" as the target —
   * one day's occupancy snapshot: how many rooms are occupied, checking in, and staying over,
   * plus the revenue/GST/collected/pending behind it, with a per-booking breakdown and a
   * per-channel (OTA) revenue summary. Commission is read from the booking's own stored
   * `channelBreakdown` (set per §channel-economics) when present — a direct/walk-in booking
   * has none, so its commission is simply 0.
   */
  async getCheckInCheckOutReport(input: { hotelId: string; from: Date; to: Date }) {
    const toInclusive = endOfDay(input.to);

    // §bugfix — "checked-in" used to mean "this booking's current status happens to be
    // checked_in/checked_out", so a guest who arrived a week ago and is still staying got
    // double-counted as both "checked-in" AND "stay over" (and their full-stay revenue got
    // re-added on every single day this report was run for). Arrivals below are scoped to the
    // period itself — bookings whose check-in actually falls in [from, to] — same "revenue
    // counted on check-in day, never per night" convention this app's own Sale Report already
    // uses, so this only counts a stay's revenue once, ever.
    const arrivals = await this.prisma.booking.findMany({
      where: {
        hotelId: input.hotelId,
        checkIn: { gte: input.from, lte: toInclusive },
        status: { in: ['confirmed', 'checked_in', 'checked_out'] },
      },
      include: { assignedRoom: true, lineItems: true },
    });

    // In-house before the period started and still here through it — adds to Occupancy, not
    // Revenue (its revenue was already counted on its own, earlier check-in day).
    const stayOver = await this.prisma.booking.count({
      where: { hotelId: input.hotelId, checkIn: { lt: input.from }, checkOut: { gt: input.from }, status: 'checked_in' },
    });

    // §bugfix — "Collected"/"Pending" used to read a booking's lifetime paidAmount for every
    // booking touching the period, which isn't what either word means on a daily report: this is
    // the actual cash the front desk took in during [from, to], from Payment's own collectedAt,
    // not from whichever bookings happen to overlap these dates.
    const payments = await this.prisma.payment.findMany({
      where: { collectedAt: { gte: input.from, lte: toInclusive }, booking: { hotelId: input.hotelId } },
    });
    const collected = payments.reduce((sum, p) => sum + Number(p.amount), 0);

    let revenue = 0;
    let totalGst = 0;
    let totalCommission = 0;
    const details: {
      id: string;
      guestName: string;
      roomNumber: string;
      source: string;
      checkIn: string;
      checkOut: string;
      gst: number;
      commission: number;
      paid: number;
      total: number;
      payable: number;
    }[] = [];
    const byOta = new Map<string, { bookings: number; gross: number; commission: number; gst: number; paid: number }>();

    for (const b of arrivals) {
      const totals = computeInvoiceTotals({
        totalAmount: Number(b.totalAmount),
        lineItems: b.lineItems.map((li) => ({ ...li, unitPrice: Number(li.unitPrice), amount: Number(li.amount) })),
        discountAmount: b.discountAmount ? Number(b.discountAmount) : null,
        gstExempt: b.gstExempt,
      });
      const paid = Number(b.paidAmount ?? 0);
      const breakdown = (b.channelBreakdown ?? {}) as Record<string, unknown>;
      const commission = typeof breakdown.commission === 'number' ? breakdown.commission : 0;

      revenue += totals.grandTotal;
      totalGst += totals.gst.amount;
      totalCommission += commission;

      details.push({
        id: b.id,
        guestName: b.guestName,
        roomNumber: b.assignedRoom?.roomNumber ?? '—',
        source: b.source,
        checkIn: b.checkIn.toISOString(),
        checkOut: b.checkOut.toISOString(),
        gst: totals.gst.amount,
        commission,
        paid,
        total: totals.grandTotal,
        payable: totals.grandTotal - commission,
      });

      if (b.source !== 'direct' && b.source !== 'walk_in') {
        const entry = byOta.get(b.source) ?? { bookings: 0, gross: 0, commission: 0, gst: 0, paid: 0 };
        entry.bookings += 1;
        entry.gross += totals.grandTotal;
        entry.commission += commission;
        entry.gst += totals.gst.amount;
        entry.paid += paid;
        byOta.set(b.source, entry);
      }
    }

    const netPayable = revenue - totalCommission;
    return {
      occupancy: arrivals.length + stayOver,
      checkedIn: arrivals.length,
      stayOver,
      revenue,
      totalGst,
      totalCommission,
      netPayable,
      collected,
      pending: Math.max(0, revenue - collected),
      details,
      otaRevenue: [...byOta.entries()].map(([source, v]) => ({
        source,
        bookings: v.bookings,
        gross: v.gross,
        commission: v.commission,
        gst: v.gst,
        net: v.gross - v.commission,
        paid: v.paid,
        pending: Math.max(0, v.gross - v.paid),
      })),
    };
  }
}
