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

    // §user request — "Room No, Guest Name, Phone No, Room Rent, Check In, Check In Via, Check
    // Out, Check Out Via, Cleaned By, Cleaned At, Discrepancy Reason": one row per stay, joining
    // the booking's own checked-in/out timestamps to its Checkout Cleaning record (matched by
    // CleaningRecord.stayId, which is just the booking id as a plain string — no declared FK, set
    // in cleaning.service.ts at submission time). `checkedOutBy` set means the FMO's own
    // "Check-out Guest" ran; left null but checkedOutAt still set means a Checkout Cleaning closed
    // it out on its own. A *flagged* cleaning (§8.7 Theft Protection) has no stayId by
    // construction — it found no active stay at all — so it can't be a booking's row; it gets its
    // own standalone row instead (room + who cleaned + when, guest columns blank), red while
    // unresolved and green once resolveDiscrepancy has run, same colours/rule the user asked for.
    const roomsById = new Map(rooms.map((r) => [r.id, r]));
    const userIds = new Set<string>();
    for (const b of bookings) if (b.checkedOutBy) userIds.add(b.checkedOutBy);
    for (const c of cleanings) {
      userIds.add(c.primaryHousekeeperId);
      if (c.secondHousekeeperId) userIds.add(c.secondHousekeeperId);
    }
    const users = userIds.size > 0 ? await this.prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, name: true } }) : [];
    const userName = new Map(users.map((u) => [u.id, u.name]));

    const bookingRows = bookings
      .filter((b) => b.assignedRoomId && (b.status === 'checked_in' || b.status === 'checked_out'))
      .map((b) => {
        const checkoutCleaning = cleanings.find((c) => c.stayId === b.id && c.kind === 'checkout');
        return {
          id: `booking-${b.id}`,
          roomNumber: roomsById.get(b.assignedRoomId!)?.roomNumber ?? '—',
          guestName: b.guestName as string | null,
          guestPhone: b.guestPhone,
          roomRent: Number(b.totalAmount) as number | null,
          checkInAt: b.checkedInAt ? b.checkedInAt.toISOString() : null,
          checkInVia: b.source as string | null,
          checkOutAt: b.checkedOutAt ? b.checkedOutAt.toISOString() : null,
          checkedOutVia: b.checkedOutAt ? (b.checkedOutBy ? ('fmo' as const) : ('housekeeping' as const)) : null,
          checkedOutByName: b.checkedOutBy ? (userName.get(b.checkedOutBy) ?? '—') : null,
          cleanedBy: checkoutCleaning ? (userName.get(checkoutCleaning.primaryHousekeeperId) ?? '—') : null,
          cleanedAt: checkoutCleaning ? checkoutCleaning.createdAt.toISOString() : null,
          discrepancy: 'none' as const,
          discrepancyReason: null as string | null,
        };
      });

    const discrepancyRows = cleanings
      .filter((c) => c.flagged)
      .map((c) => ({
        id: `discrepancy-${c.id}`,
        roomNumber: roomsById.get(c.roomId)?.roomNumber ?? '—',
        guestName: null as string | null,
        guestPhone: null as string | null,
        roomRent: null as number | null,
        checkInAt: null as string | null,
        checkInVia: null as string | null,
        checkOutAt: null as string | null,
        checkedOutVia: null as 'fmo' | 'housekeeping' | null,
        checkedOutByName: null as string | null,
        cleanedBy: userName.get(c.primaryHousekeeperId) ?? '—',
        cleanedAt: c.createdAt.toISOString(),
        discrepancy: (c.resolvedAt ? 'resolved' : 'unresolved') as 'resolved' | 'unresolved',
        discrepancyReason: c.resolvedAt ? (c.resolvedNote ?? 'Resolved') : 'No guest check-in found for this cleaning',
      }));

    const stayLog = [...bookingRows, ...discrepancyRows].sort((a, b) => (a.checkInAt ?? a.cleanedAt ?? '').localeCompare(b.checkInAt ?? b.cleanedAt ?? ''));

    return {
      days: Array.from(days.values()).sort((a, b) => a.date.localeCompare(b.date)),
      rooms: perRoom,
      stayLog,
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

  /** Shared by Credit and Debit / Account Book / Day Book below — the same "Payment rows read as
   * cash-in, tagged Room" merge Ledger's own listTransactions already does, duplicated here rather
   * than imported so ReportsService stays self-contained (same reasoning as the rest of this
   * file's own Prisma queries). */
  private async getMergedTransactions(hotelId: string, from: Date, to: Date) {
    const [entries, payments] = await Promise.all([
      this.prisma.ledgerEntry.findMany({
        where: { hotelId, createdAt: { gte: from, lte: to } },
        include: { category: true },
      }),
      this.prisma.payment.findMany({
        where: { booking: { hotelId }, collectedAt: { gte: from, lte: to } },
        include: { booking: { include: { assignedRoom: true } } },
      }),
    ]);
    const merged = [
      ...entries.map((e) => ({
        id: e.id,
        type: e.type,
        amount: Number(e.amount),
        paymentMethod: e.paymentMethod as string,
        category: e.category?.name ?? null,
        remarks: e.remarks,
        createdAt: e.createdAt,
        bookingId: null as string | null,
        guestName: null as string | null,
        roomNumber: null as string | null,
      })),
      ...payments.map((p) => ({
        id: p.id,
        type: 'cash_in' as const,
        amount: Number(p.amount),
        paymentMethod: p.method as string,
        category: 'Room',
        remarks: null as string | null,
        createdAt: p.collectedAt,
        bookingId: p.booking.id,
        guestName: p.booking.guestName as string | null,
        roomNumber: p.booking.assignedRoom?.roomNumber ?? null,
      })),
    ];
    merged.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return merged;
  }

  /** §user request, with a reference app's own "Advance Received Report" as the target — every
   * advance-type payment in the range, one receipt row each. */
  async getAdvanceReceivedReport(input: { hotelId: string; from: Date; to: Date }) {
    const toInclusive = endOfDay(input.to);
    const payments = await this.prisma.payment.findMany({
      where: { booking: { hotelId: input.hotelId }, type: 'advance', collectedAt: { gte: input.from, lte: toInclusive } },
      include: { booking: { include: { assignedRoom: true } } },
      orderBy: { collectedAt: 'asc' },
    });
    const seen = new Map<string, number>();
    const rows = payments.map((p) => {
      const n = (seen.get(p.bookingId) ?? 0) + 1;
      seen.set(p.bookingId, n);
      const code = `BK-${p.booking.id.slice(-6).toUpperCase()}`;
      return {
        id: p.id,
        date: p.collectedAt.toISOString(),
        receiptNo: `${code}-${n}`,
        guestName: p.booking.guestName,
        amount: Number(p.amount),
        remark: `${p.booking.guestName}, Booking: ${code}, Room: ${p.booking.assignedRoom?.roomNumber ?? '—'}`,
      };
    });
    return { rows, totalAdvance: rows.reduce((s, r) => s + r.amount, 0) };
  }

  /** §user request, with a reference app's own "Room Sale Report" as the target — a tax-invoice
   * style row per room booking (same "revenue counted on check-in day" convention as Sale Report),
   * with GST split evenly into CGST/SGST (standard for an intra-state Indian hotel bill). */
  async getRoomSaleReport(input: { hotelId: string; from: Date; to: Date }) {
    const toInclusive = endOfDay(input.to);
    const bookings = await this.prisma.booking.findMany({
      where: { hotelId: input.hotelId, checkIn: { gte: input.from, lte: toInclusive }, status: { not: 'void' } },
      include: { assignedRoom: true, lineItems: true, payments: true },
      orderBy: { checkIn: 'asc' },
    });
    let totalBase = 0;
    let totalCgst = 0;
    let totalSgst = 0;
    let grandTotal = 0;
    let totalCommission = 0;
    let totalNights = 0;
    const rows = bookings.map((b) => {
      const totals = computeInvoiceTotals({
        totalAmount: Number(b.totalAmount),
        lineItems: b.lineItems.map((li) => ({ ...li, unitPrice: Number(li.unitPrice), amount: Number(li.amount) })),
        discountAmount: b.discountAmount ? Number(b.discountAmount) : null,
        gstExempt: b.gstExempt,
      });
      const cgst = totals.gst.amount / 2;
      const sgst = totals.gst.amount / 2;
      const breakdown = (b.channelBreakdown ?? {}) as Record<string, unknown>;
      const commission = typeof breakdown.commission === 'number' ? breakdown.commission : 0;
      totalBase += totals.basePrice;
      totalCgst += cgst;
      totalSgst += sgst;
      grandTotal += totals.grandTotal;
      totalCommission += commission;
      totalNights += b.nights;
      return {
        id: b.id,
        invoiceDate: b.createdAt.toISOString(),
        invoiceNumber: `BK-${b.id.slice(-6).toUpperCase()}`,
        guestName: b.guestName,
        gstNo: b.billToCompanyGstin,
        checkIn: b.checkIn.toISOString(),
        checkOut: b.checkOut.toISOString(),
        roomNumber: b.assignedRoom?.roomNumber ?? '—',
        roomTariff: b.nights > 0 ? totals.basePrice / b.nights : totals.basePrice,
        nights: b.nights,
        baseAmount: totals.basePrice,
        cgst,
        sgst,
        grandTotal: totals.grandTotal,
        commissionPayable: commission,
        modeOfPayment: b.payments[0]?.method ?? null,
      };
    });
    return { rows, summary: { totalBookings: rows.length, totalRooms: rows.length, totalNights, totalBase, totalCgst, totalSgst, grandTotal, totalCommission } };
  }

  /** §user request, with a reference app's own "GST Bill Report" as the target — only bookings
   * actually billed to a GSTIN (company billing, for the guest's own input credit), not every
   * booking — a hotel with no B2B stays in the range correctly shows none. */
  async getGstBillReport(input: { hotelId: string; from: Date; to: Date }) {
    const toInclusive = endOfDay(input.to);
    const bookings = await this.prisma.booking.findMany({
      where: { hotelId: input.hotelId, checkIn: { gte: input.from, lte: toInclusive }, billToCompanyGstin: { not: null } },
      include: { lineItems: true },
      orderBy: { checkIn: 'asc' },
    });
    return bookings.map((b) => {
      const totals = computeInvoiceTotals({
        totalAmount: Number(b.totalAmount),
        lineItems: b.lineItems.map((li) => ({ ...li, unitPrice: Number(li.unitPrice), amount: Number(li.amount) })),
        discountAmount: b.discountAmount ? Number(b.discountAmount) : null,
        gstExempt: b.gstExempt,
      });
      return {
        id: b.id,
        gstNo: b.billToCompanyGstin,
        receiverName: b.billToCompanyName ?? b.guestName,
        invoiceDate: b.createdAt.toISOString(),
        invoiceNumber: `BK-${b.id.slice(-6).toUpperCase()}`,
        guestName: b.guestName,
        checkIn: b.checkIn.toISOString(),
        checkOut: b.checkOut.toISOString(),
        rooms: 1,
        nights: b.nights,
        baseValue: totals.basePrice,
        cgst: totals.gst.amount / 2,
        sgst: totals.gst.amount / 2,
        invoiceValue: totals.grandTotal,
      };
    });
  }

  /** §user request, with a reference app's own "Payment Receipts" as the target — every payment
   * in the range as one on-screen row (unlike the PDF-style reports above), for a front desk to
   * search/filter directly rather than print. */
  async getPaymentReceiptsReport(input: { hotelId: string; from: Date; to: Date }) {
    const toInclusive = endOfDay(input.to);
    const payments = await this.prisma.payment.findMany({
      where: { booking: { hotelId: input.hotelId }, collectedAt: { gte: input.from, lte: toInclusive } },
      include: { booking: { include: { assignedRoom: true } } },
      orderBy: { collectedAt: 'desc' },
    });
    return payments.map((p) => ({
      id: p.id,
      receiptNo: p.id.slice(-6).toUpperCase(),
      receiptDate: p.collectedAt.toISOString(),
      bookingCode: `BK-${p.booking.id.slice(-6).toUpperCase()}`,
      guestName: p.booking.guestName,
      checkIn: p.booking.checkIn.toISOString(),
      checkOut: p.booking.checkOut.toISOString(),
      roomNumber: p.booking.assignedRoom?.roomNumber ?? '—',
      paymentType: p.type,
      paymentMethod: p.method,
      amount: Number(p.amount),
    }));
  }

  /** §user request, with a reference app's own "Profit And Loss Report" as the target — revenue
   * (net of discount, commission and GST broken out) against Ledger's own Cash Out entries as
   * operating expenses, grouped by category. No cost-of-goods concept exists in this app (a hotel
   * stay has no COGS the way physical inventory would), so "profit" here is simply revenue minus
   * these logged expenses. */
  async getProfitAndLossReport(input: { hotelId: string; from: Date; to: Date }) {
    const toInclusive = endOfDay(input.to);
    const bookings = await this.prisma.booking.findMany({
      where: { hotelId: input.hotelId, checkIn: { gte: input.from, lte: toInclusive }, status: { not: 'void' } },
      include: { lineItems: true },
    });
    let netRevenue = 0;
    let gst = 0;
    let commission = 0;
    for (const b of bookings) {
      const totals = computeInvoiceTotals({
        totalAmount: Number(b.totalAmount),
        lineItems: b.lineItems.map((li) => ({ ...li, unitPrice: Number(li.unitPrice), amount: Number(li.amount) })),
        discountAmount: b.discountAmount ? Number(b.discountAmount) : null,
        gstExempt: b.gstExempt,
      });
      netRevenue += totals.subtotal - totals.discount;
      gst += totals.gst.amount;
      const breakdown = (b.channelBreakdown ?? {}) as Record<string, unknown>;
      commission += typeof breakdown.commission === 'number' ? breakdown.commission : 0;
    }
    const grossRevenue = netRevenue + gst;

    const expenseEntries = await this.prisma.ledgerEntry.findMany({
      where: { hotelId: input.hotelId, type: 'cash_out', createdAt: { gte: input.from, lte: toInclusive } },
      include: { category: true },
    });
    const byCategory = new Map<string, number>();
    for (const e of expenseEntries) {
      const name = e.category?.name ?? 'Uncategorized';
      byCategory.set(name, (byCategory.get(name) ?? 0) + Number(e.amount));
    }
    const expenses = [...byCategory.entries()].map(([category, amount]) => ({ category, amount }));
    const totalExpenses = expenses.reduce((s, r) => s + r.amount, 0);

    return { netRevenue, commission, gst, grossRevenue, expenses, totalExpenses, netProfit: netRevenue - totalExpenses };
  }

  /** §user request, with a reference app's own "Credit and Debit Report" as the target — the same
   * merged Payment+Ledger view as Day Book/Account Book, summed into Total Credit/Debit/Net
   * Balance stat tiles plus a flat on-screen list. */
  async getCreditAndDebitReport(input: { hotelId: string; from: Date; to: Date }) {
    const toInclusive = endOfDay(input.to);
    const merged = await this.getMergedTransactions(input.hotelId, input.from, toInclusive);
    const totalCredit = merged.filter((m) => m.type === 'cash_in').reduce((s, m) => s + m.amount, 0);
    const totalDebit = merged.filter((m) => m.type === 'cash_out').reduce((s, m) => s + m.amount, 0);
    return {
      totalCredit,
      totalDebit,
      netBalance: totalCredit - totalDebit,
      rows: merged.map((m) => ({
        id: m.id,
        date: m.createdAt.toISOString(),
        description: m.bookingId ? `${m.guestName}, Room: ${m.roomNumber ?? '—'}` : m.remarks || m.category || 'Entry',
        method: m.paymentMethod,
        amount: m.amount,
        type: m.type,
      })),
    };
  }

  /** §user request, with a reference app's own "Room Wise Revenue Report" as the target — every
   * active room, every night of the range: how many it was actually occupied, vs how many it
   * could have been sold (`active` rooms only — one room per night, same inventory unit the
   * Channel Manager's own availability pool already treats a room as). */
  async getRoomWiseRevenueReport(input: { hotelId: string; from: Date; to: Date }) {
    const toInclusive = endOfDay(input.to);
    const availableNightsPerRoom = Math.max(1, Math.round((toInclusive.getTime() - input.from.getTime()) / 86400000) + 1);
    const [rooms, bookings] = await Promise.all([
      this.prisma.room.findMany({ where: { hotelId: input.hotelId, active: true }, include: { roomCategory: true } }),
      this.prisma.booking.findMany({
        where: { hotelId: input.hotelId, checkIn: { gte: input.from, lte: toInclusive }, status: { not: 'void' }, assignedRoomId: { not: null } },
        include: { lineItems: true },
      }),
    ]);
    const byRoom = new Map<string, { occupiedNights: number; roomRevenue: number; otherRevenue: number }>();
    for (const b of bookings) {
      if (!b.assignedRoomId) continue;
      const totals = computeInvoiceTotals({
        totalAmount: Number(b.totalAmount),
        lineItems: b.lineItems.map((li) => ({ ...li, unitPrice: Number(li.unitPrice), amount: Number(li.amount) })),
        discountAmount: b.discountAmount ? Number(b.discountAmount) : null,
        gstExempt: b.gstExempt,
      });
      const entry = byRoom.get(b.assignedRoomId) ?? { occupiedNights: 0, roomRevenue: 0, otherRevenue: 0 };
      entry.occupiedNights += b.nights;
      entry.roomRevenue += totals.basePrice;
      entry.otherRevenue += totals.extraCharges;
      byRoom.set(b.assignedRoomId, entry);
    }
    const rows = rooms.map((r) => {
      const entry = byRoom.get(r.id) ?? { occupiedNights: 0, roomRevenue: 0, otherRevenue: 0 };
      return {
        roomId: r.id,
        roomNumber: r.roomNumber,
        roomType: r.roomCategory?.name ?? '—',
        occupiedNights: entry.occupiedNights,
        availableNights: availableNightsPerRoom,
        occupancyPercent: availableNightsPerRoom > 0 ? (entry.occupiedNights / availableNightsPerRoom) * 100 : 0,
        roomRevenue: entry.roomRevenue,
        otherRevenue: entry.otherRevenue,
        totalRevenue: entry.roomRevenue + entry.otherRevenue,
      };
    });
    const totalOccupied = rows.reduce((s, r) => s + r.occupiedNights, 0);
    const totalAvailable = rooms.length * availableNightsPerRoom;
    return {
      rows,
      summary: {
        totalRooms: rooms.length,
        occupiedNights: totalOccupied,
        availableNights: totalAvailable,
        avgOccupancy: totalAvailable > 0 ? (totalOccupied / totalAvailable) * 100 : 0,
        roomRevenue: rows.reduce((s, r) => s + r.roomRevenue, 0),
        otherRevenue: rows.reduce((s, r) => s + r.otherRevenue, 0),
        totalRevenue: rows.reduce((s, r) => s + r.totalRevenue, 0),
      },
    };
  }

  /** §user request, with a reference app's own "Invoice Bills" as the target — every booking in
   * the range as a plain invoice-status row (Paid/Partially Paid/Unpaid), the simplest of the
   * bill-shaped reports above. */
  async getInvoiceBillsReport(input: { hotelId: string; from: Date; to: Date }) {
    const toInclusive = endOfDay(input.to);
    const bookings = await this.prisma.booking.findMany({
      where: { hotelId: input.hotelId, checkIn: { gte: input.from, lte: toInclusive }, status: { not: 'void' } },
      include: { assignedRoom: true, lineItems: true },
      orderBy: { checkIn: 'asc' },
    });
    return bookings.map((b) => {
      const totals = computeInvoiceTotals({
        totalAmount: Number(b.totalAmount),
        lineItems: b.lineItems.map((li) => ({ ...li, unitPrice: Number(li.unitPrice), amount: Number(li.amount) })),
        discountAmount: b.discountAmount ? Number(b.discountAmount) : null,
        gstExempt: b.gstExempt,
      });
      const paid = Number(b.paidAmount ?? 0);
      const due = Math.max(0, totals.grandTotal - paid);
      return {
        id: b.id,
        invoiceNumber: `BK-${b.id.slice(-6).toUpperCase()}`,
        guestName: b.guestName,
        roomNumber: b.assignedRoom?.roomNumber ?? '—',
        checkIn: b.checkIn.toISOString(),
        checkOut: b.checkOut.toISOString(),
        total: totals.grandTotal,
        paid,
        due,
        status: due <= 0 ? 'Paid' : paid > 0 ? 'Partially Paid' : 'Unpaid',
      };
    });
  }

  /** §user request, with a reference app's own "Payment Report" as the target — every payment in
   * the range as a flat row plus a by-method summary, the printable counterpart to the on-screen
   * Payment Receipts above. */
  async getPaymentReport(input: { hotelId: string; from: Date; to: Date }) {
    const toInclusive = endOfDay(input.to);
    const payments = await this.prisma.payment.findMany({
      where: { booking: { hotelId: input.hotelId }, collectedAt: { gte: input.from, lte: toInclusive } },
      include: { booking: { include: { assignedRoom: true } } },
      orderBy: { collectedAt: 'asc' },
    });
    const byMethod = new Map<string, number>();
    const rows = payments.map((p) => {
      byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + Number(p.amount));
      return {
        id: p.id,
        date: p.collectedAt.toISOString(),
        guestName: p.booking.guestName,
        bookingCode: `BK-${p.booking.id.slice(-6).toUpperCase()}`,
        roomNumber: p.booking.assignedRoom?.roomNumber ?? '—',
        method: p.method,
        reference: p.referenceNumber,
        amount: Number(p.amount),
      };
    });
    return { rows, total: rows.reduce((s, r) => s + r.amount, 0), byMethod: [...byMethod.entries()].map(([method, amount]) => ({ method, amount })) };
  }

  /** §user request, with a reference app's own "Account Book Report" as the target — a classic
   * ledger page: an opening balance carried in from everything before the range (since the
   * hotel's own ledgerOpeningDate, same cutoff getSummary already uses), the range's own
   * transactions in chronological order, and the resulting closing balance. */
  async getAccountBookReport(input: { hotelId: string; from: Date; to: Date }) {
    const toInclusive = endOfDay(input.to);
    const hotel = await this.prisma.hotel.findUniqueOrThrow({ where: { id: input.hotelId }, select: { ledgerOpeningBalance: true, ledgerOpeningDate: true } });
    const openingFrom = hotel.ledgerOpeningDate ?? new Date(0);
    const [priorEntries, priorPayments] = await Promise.all([
      this.prisma.ledgerEntry.findMany({ where: { hotelId: input.hotelId, createdAt: { gte: openingFrom, lt: input.from } } }),
      this.prisma.payment.findMany({ where: { booking: { hotelId: input.hotelId }, collectedAt: { gte: openingFrom, lt: input.from } } }),
    ]);
    let opening = Number(hotel.ledgerOpeningBalance ?? 0);
    for (const e of priorEntries) opening += e.type === 'cash_in' ? Number(e.amount) : -Number(e.amount);
    for (const p of priorPayments) opening += Number(p.amount);

    const merged = await this.getMergedTransactions(input.hotelId, input.from, toInclusive);
    const periodCredit = merged.filter((m) => m.type === 'cash_in').reduce((s, m) => s + m.amount, 0);
    const periodDebit = merged.filter((m) => m.type === 'cash_out').reduce((s, m) => s + m.amount, 0);
    return {
      opening,
      closing: opening + periodCredit - periodDebit,
      periodCredit,
      periodDebit,
      rows: merged
        .slice()
        .reverse()
        .map((m) => ({
          id: m.id,
          date: m.createdAt.toISOString(),
          description: m.bookingId ? `${m.guestName} — Room ${m.roomNumber ?? '—'}` : m.remarks || m.category || 'Entry',
          type: m.type,
          amount: m.amount,
        })),
    };
  }

  /** §user request, with a reference app's own "Advance Adjustment Report" as the target — how
   * much of each booking's advance has actually been applied against its final bill, and what's
   * still outstanding. */
  async getAdvanceAdjustmentReport(input: { hotelId: string; from: Date; to: Date }) {
    const toInclusive = endOfDay(input.to);
    const bookings = await this.prisma.booking.findMany({
      where: { hotelId: input.hotelId, checkIn: { gte: input.from, lte: toInclusive }, status: { not: 'void' } },
      include: { assignedRoom: true, lineItems: true, payments: true },
    });
    return bookings
      .filter((b) => b.payments.length > 0)
      .map((b) => {
        const totals = computeInvoiceTotals({
          totalAmount: Number(b.totalAmount),
          lineItems: b.lineItems.map((li) => ({ ...li, unitPrice: Number(li.unitPrice), amount: Number(li.amount) })),
          discountAmount: b.discountAmount ? Number(b.discountAmount) : null,
          gstExempt: b.gstExempt,
        });
        const advanceReceived = b.payments.filter((p) => p.type === 'advance').reduce((s, p) => s + Number(p.amount), 0);
        const totalPaid = b.payments.reduce((s, p) => s + Number(p.amount), 0);
        return {
          id: b.id,
          bookingCode: `BK-${b.id.slice(-6).toUpperCase()}`,
          guestName: b.guestName,
          roomNumber: b.assignedRoom?.roomNumber ?? '—',
          advanceReceived,
          adjustedAgainstStay: Math.min(advanceReceived, totals.grandTotal),
          balanceDue: Math.max(0, totals.grandTotal - totalPaid),
        };
      });
  }

  /** §user request, with a reference app's own "Day Book Report" as the target — the same merged
   * Payment+Ledger transactions as Account Book/Credit and Debit, grouped into one section per
   * calendar day with its own credit/debit subtotal (a classic accounting "day book", one page per
   * day), reusing this app's own Daily Expenses report's day-grouping idea but for both directions
   * of cash movement instead of just Cash Out. */
  async getDayBookReport(input: { hotelId: string; from: Date; to: Date }) {
    const toInclusive = endOfDay(input.to);
    const merged = await this.getMergedTransactions(input.hotelId, input.from, toInclusive);
    const byDay = new Map<string, { credit: number; debit: number; items: typeof merged }>();
    for (const m of merged) {
      const key = dayKey(m.createdAt);
      const entry = byDay.get(key) ?? { credit: 0, debit: 0, items: [] };
      if (m.type === 'cash_in') entry.credit += m.amount;
      else entry.debit += m.amount;
      entry.items.push(m);
      byDay.set(key, entry);
    }
    return [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, { credit, debit, items }]) => ({
        date,
        credit,
        debit,
        net: credit - debit,
        items: items
          .slice()
          .reverse()
          .map((m) => ({
            id: m.id,
            description: m.bookingId ? `${m.guestName} — Room ${m.roomNumber ?? '—'}` : m.remarks || m.category || 'Entry',
            type: m.type,
            amount: m.amount,
            method: m.paymentMethod,
          })),
      }));
  }

  /** §user request, with a reference app's own "OTA Booking Report" as the target — per-OTA
   * revenue/commission/GST for the selected range, plus a fixed "this calendar month" context
   * (Previous Revenue MTD = the month so far, not counting today; Today's Revenue; the two
   * summed as Month-to-Date) alongside it — independent of whatever range is picked below. */
  async getOtaBookingReport(input: { hotelId: string; from: Date; to: Date }) {
    const toInclusive = endOfDay(input.to);
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const todayEnd = endOfDay(todayStart);

    const sumRevenue = (rows: { totalAmount: unknown; lineItems: { unitPrice: unknown; amount: unknown; description: string; quantity: number }[]; discountAmount: unknown; gstExempt: boolean }[]) =>
      rows.reduce((sum, b) => {
        const totals = computeInvoiceTotals({
          totalAmount: Number(b.totalAmount),
          lineItems: b.lineItems.map((li) => ({ ...li, unitPrice: Number(li.unitPrice), amount: Number(li.amount) })),
          discountAmount: b.discountAmount ? Number(b.discountAmount) : null,
          gstExempt: b.gstExempt,
        });
        return sum + totals.grandTotal;
      }, 0);

    const [monthBookings, todayBookings, rangeBookings] = await Promise.all([
      this.prisma.booking.findMany({ where: { hotelId: input.hotelId, checkIn: { gte: monthStart, lt: todayStart }, status: { not: 'void' } }, include: { lineItems: true } }),
      this.prisma.booking.findMany({ where: { hotelId: input.hotelId, checkIn: { gte: todayStart, lte: todayEnd }, status: { not: 'void' } }, include: { lineItems: true } }),
      this.prisma.booking.findMany({
        where: { hotelId: input.hotelId, checkIn: { gte: input.from, lte: toInclusive }, status: { not: 'void' }, source: { notIn: ['direct', 'walk_in'] } },
        include: { lineItems: true },
      }),
    ]);

    const previousRevenueMtd = sumRevenue(monthBookings);
    const todaysRevenue = sumRevenue(todayBookings);

    const byOta = new Map<string, { totalAmount: number; totalCommission: number; totalGst: number }>();
    for (const b of rangeBookings) {
      const totals = computeInvoiceTotals({
        totalAmount: Number(b.totalAmount),
        lineItems: b.lineItems.map((li) => ({ ...li, unitPrice: Number(li.unitPrice), amount: Number(li.amount) })),
        discountAmount: b.discountAmount ? Number(b.discountAmount) : null,
        gstExempt: b.gstExempt,
      });
      const breakdown = (b.channelBreakdown ?? {}) as Record<string, unknown>;
      const commission = typeof breakdown.commission === 'number' ? breakdown.commission : 0;
      const entry = byOta.get(b.source) ?? { totalAmount: 0, totalCommission: 0, totalGst: 0 };
      entry.totalAmount += totals.grandTotal;
      entry.totalCommission += commission;
      entry.totalGst += totals.gst.amount;
      byOta.set(b.source, entry);
    }

    return {
      previousRevenueMtd,
      todaysRevenue,
      monthToDateRevenue: previousRevenueMtd + todaysRevenue,
      rows: [...byOta.entries()].map(([source, v]) => ({
        source,
        totalAmount: v.totalAmount,
        totalCommission: v.totalCommission,
        totalGst: v.totalGst,
        amountToHotel: v.totalAmount - v.totalCommission,
      })),
    };
  }

  /** §user request, with a reference app's own "OTA Revenue Report" as the target — every source
   * (OTA or not — the reference's own example includes a "walk-in" row, so this follows suit),
   * with totals and a per-source Bookings/Revenue/Payments breakdown, optionally narrowed to one
   * source via the "Select OTA" filter. */
  async getOtaRevenueReport(input: { hotelId: string; from: Date; to: Date; source?: string }) {
    const toInclusive = endOfDay(input.to);
    const bookings = await this.prisma.booking.findMany({
      where: {
        hotelId: input.hotelId,
        checkIn: { gte: input.from, lte: toInclusive },
        status: { not: 'void' },
        ...(input.source ? { source: input.source as never } : {}),
      },
      include: { lineItems: true },
    });

    let totalRevenue = 0;
    let collected = 0;
    let commission = 0;
    const byOta = new Map<string, { bookings: number; nights: number; gross: number; commission: number; paid: number }>();
    for (const b of bookings) {
      const totals = computeInvoiceTotals({
        totalAmount: Number(b.totalAmount),
        lineItems: b.lineItems.map((li) => ({ ...li, unitPrice: Number(li.unitPrice), amount: Number(li.amount) })),
        discountAmount: b.discountAmount ? Number(b.discountAmount) : null,
        gstExempt: b.gstExempt,
      });
      const paid = Number(b.paidAmount ?? 0);
      const breakdown = (b.channelBreakdown ?? {}) as Record<string, unknown>;
      const comm = typeof breakdown.commission === 'number' ? breakdown.commission : 0;
      totalRevenue += totals.grandTotal;
      collected += paid;
      commission += comm;
      const entry = byOta.get(b.source) ?? { bookings: 0, nights: 0, gross: 0, commission: 0, paid: 0 };
      entry.bookings += 1;
      entry.nights += b.nights;
      entry.gross += totals.grandTotal;
      entry.commission += comm;
      entry.paid += paid;
      byOta.set(b.source, entry);
    }

    return {
      totalRooms: bookings.length,
      totalRevenue,
      collected,
      pending: Math.max(0, totalRevenue - collected),
      commission,
      netPayment: totalRevenue - commission,
      rows: [...byOta.entries()].map(([source, v]) => ({
        source,
        bookings: v.bookings,
        nights: v.nights,
        gross: v.gross,
        commissionPercent: v.gross > 0 ? (v.commission / v.gross) * 100 : 0,
        commission: v.commission,
        net: v.gross - v.commission,
        paid: v.paid,
        pending: Math.max(0, v.gross - v.paid),
      })),
    };
  }

  /** §user request, with a reference app's own guest-analytics dashboard as the target — guest
   * growth, demographics, top customers and VIP tiering. A "repeat" guest is one with more than
   * one Booking row (any status — even a cancelled second visit still means they came back), and
   * every stat here counts distinct *guests*, not bookings, except where noted. "Loyalty members"
   * is the same number as repeat guests for now — there's no actual loyalty/membership program
   * yet (§user request: that's deliberately future work, not built here), so this just reuses the
   * one guest-return signal this app already has.
   */
  async getCustomersReport(hotelId: string) {
    const guests = await this.prisma.guest.findMany({
      where: { hotelId },
      include: { bookings: { include: { lineItems: true }, orderBy: { createdAt: 'asc' } } },
    });

    const totalGuests = guests.length;
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    let activeGuests = 0;
    let directBookings = 0;
    let otaBookings = 0;
    const monthly = new Map<string, { new: number; repeat: number }>();
    const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const bump = (key: string, field: 'new' | 'repeat') => {
      const row = monthly.get(key) ?? { new: 0, repeat: 0 };
      row[field] += 1;
      monthly.set(key, row);
    };

    const byState = new Map<string, number>();
    const byCountry = new Map<string, number>();
    const byCity = new Map<string, number>();
    let guestsWithState = 0;

    const ageBucket = (dob: Date): string => {
      const age = Math.floor((Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
      if (age < 18) return 'Under 18';
      if (age <= 25) return '18-25';
      if (age <= 35) return '26-35';
      if (age <= 45) return '36-45';
      if (age <= 55) return '46-55';
      if (age <= 65) return '56-65';
      return '65+';
    };
    const allAges = new Map<string, number>();
    const repeatAges = new Map<string, number>();
    let guestsWithAge = 0;

    const customers: { id: string; name: string; phone: string; bookings: number; totalSpend: number }[] = [];

    for (const g of guests) {
      const isRepeat = g.bookings.length > 1;
      if (g.state) {
        guestsWithState += 1;
        byState.set(g.state, (byState.get(g.state) ?? 0) + 1);
      }
      if (g.country) byCountry.set(g.country, (byCountry.get(g.country) ?? 0) + 1);
      if (g.city) byCity.set(g.city, (byCity.get(g.city) ?? 0) + 1);

      if (g.dateOfBirth) {
        guestsWithAge += 1;
        const bucket = ageBucket(g.dateOfBirth);
        allAges.set(bucket, (allAges.get(bucket) ?? 0) + 1);
        if (isRepeat) repeatAges.set(bucket, (repeatAges.get(bucket) ?? 0) + 1);
      } else if (isRepeat) {
        repeatAges.set('Unknown', (repeatAges.get('Unknown') ?? 0) + 1);
      }

      if (g.bookings.length > 0) bump(monthKey(g.bookings[0].createdAt), 'new');
      if (isRepeat) bump(monthKey(g.bookings[1].createdAt), 'repeat');

      let totalSpend = 0;
      let hasRealStay = false;
      for (const b of g.bookings) {
        if (b.status === 'void') continue;
        if (b.source === 'direct' || b.source === 'walk_in') directBookings += 1;
        else otaBookings += 1;
        const totals = computeInvoiceTotals({
          totalAmount: Number(b.totalAmount),
          lineItems: b.lineItems.map((li) => ({ ...li, unitPrice: Number(li.unitPrice), amount: Number(li.amount) })),
          discountAmount: b.discountAmount ? Number(b.discountAmount) : null,
          gstExempt: b.gstExempt,
        });
        totalSpend += totals.grandTotal;
        if (b.status !== 'cancelled' && b.status !== 'no_show' && b.checkIn >= ninetyDaysAgo) hasRealStay = true;
      }
      if (hasRealStay) activeGuests += 1;
      customers.push({ id: g.id, name: g.name, phone: g.phone, bookings: g.bookings.length, totalSpend });
    }

    const repeatGuestCount = guests.filter((g) => g.bookings.length > 1).length;
    const newGuestCount = totalGuests - repeatGuestCount;
    const totalBookingsForShare = directBookings + otaBookings;

    const topTen = [...customers].sort((a, b) => b.totalSpend - a.totalSpend).slice(0, 10);
    const combinedSpend = topTen.reduce((s, c) => s + c.totalSpend, 0);

    const vipTiers: { tier: string; min: number; max: number; threshold: string }[] = [
      { tier: 'VVVIP', min: 11, max: Infinity, threshold: 'More than 10 bookings' },
      { tier: 'VVIP', min: 7, max: 10, threshold: '7-10 bookings' },
      { tier: 'Gold VIP', min: 4, max: 6, threshold: '4-6 bookings' },
      { tier: 'Gold', min: 2, max: 3, threshold: '2-3 bookings' },
      { tier: 'Regular', min: 1, max: 1, threshold: '1 booking' },
    ];
    const vipBreakdown = vipTiers.map((t) => {
      const count = customers.filter((c) => c.bookings >= t.min && c.bookings <= t.max).length;
      return { tier: t.tier, threshold: t.threshold, count, percent: totalGuests > 0 ? (count / totalGuests) * 100 : 0 };
    });
    const vipCount = customers.filter((c) => c.bookings >= 2).length;

    const toRankedList = (m: Map<string, number>, denom: number) =>
      [...m.entries()].sort(([, a], [, b]) => b - a).map(([name, count]) => ({ name, count, percent: denom > 0 ? (count / denom) * 100 : 0 }));

    return {
      totalGuests,
      newGuests: newGuestCount,
      repeatGuests: repeatGuestCount,
      repeatRatePercent: totalGuests > 0 ? (repeatGuestCount / totalGuests) * 100 : 0,
      loyaltyMembers: repeatGuestCount,
      activeGuests,
      directGuestShare: {
        direct: directBookings,
        ota: otaBookings,
        percent: totalBookingsForShare > 0 ? (directBookings / totalBookingsForShare) * 100 : 0,
      },
      monthlyGrowth: [...monthly.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, v]) => ({ month, new: v.new, repeat: v.repeat })),
      guestLocations: { state: toRankedList(byState, guestsWithState), country: toRankedList(byCountry, guestsWithState), city: toRankedList(byCity, guestsWithState) },
      guestsWithState,
      ageGroups: toRankedList(allAges, guestsWithAge),
      guestsWithAge,
      repeatAgeGroups: toRankedList(repeatAges, repeatGuestCount),
      topCustomers: topTen,
      combinedSpend,
      vipCount,
      vipBreakdown,
      addressOnFilePercent: totalGuests > 0 ? (guestsWithState / totalGuests) * 100 : 0,
      ageOnFilePercent: totalGuests > 0 ? (guestsWithAge / totalGuests) * 100 : 0,
    };
  }

  /** The individual guest profile a Top Customer row links to — their own details (including the
   * ID/Aadhaar captured at an earlier check-in, carried on the Guest profile itself so it's ready
   * to reuse next time without re-scanning) plus their full booking history and where they rank by
   * spend among every guest at this hotel. */
  async getCustomerProfile(input: { hotelId: string; guestId: string }) {
    const [guest, allGuests] = await Promise.all([
      this.prisma.guest.findUniqueOrThrow({
        where: { id: input.guestId },
        include: { bookings: { include: { lineItems: true, assignedRoom: true }, orderBy: { createdAt: 'desc' } } },
      }),
      this.prisma.guest.findMany({ where: { hotelId: input.hotelId }, include: { bookings: { include: { lineItems: true } } } }),
    ]);

    const spendOf = (
      bookings: {
        status: string;
        totalAmount: unknown;
        discountAmount: unknown;
        gstExempt: boolean;
        lineItems: { unitPrice: unknown; amount: unknown; description: string; quantity: number }[];
      }[],
    ) =>
      bookings.reduce((sum, b) => {
        if (b.status === 'void') return sum;
        const totals = computeInvoiceTotals({
          totalAmount: Number(b.totalAmount),
          lineItems: b.lineItems.map((li) => ({ ...li, unitPrice: Number(li.unitPrice), amount: Number(li.amount) })),
          discountAmount: b.discountAmount ? Number(b.discountAmount) : null,
          gstExempt: b.gstExempt,
        });
        return sum + totals.grandTotal;
      }, 0);

    const totalSpend = spendOf(guest.bookings);
    const ranked = allGuests.map((g) => ({ id: g.id, spend: spendOf(g.bookings) })).sort((a, b) => b.spend - a.spend);
    const rank = ranked.findIndex((g) => g.id === guest.id) + 1;

    const bookingCount = guest.bookings.length;
    const vipTier = bookingCount >= 11 ? 'VVVIP' : bookingCount >= 7 ? 'VVIP' : bookingCount >= 4 ? 'Gold VIP' : bookingCount >= 2 ? 'Gold' : 'Regular';

    return {
      guest: {
        id: guest.id,
        name: guest.name,
        phone: guest.phone,
        email: guest.email,
        gender: guest.gender,
        dateOfBirth: guest.dateOfBirth ? guest.dateOfBirth.toISOString() : null,
        address: guest.address,
        country: guest.country,
        state: guest.state,
        city: guest.city,
        pincode: guest.pincode,
        idType: guest.idType,
        idNumber: guest.idNumber,
        idPhotoPath: guest.idPhotoPath,
        idPhotoBackPath: guest.idPhotoBackPath,
      },
      totalBookings: bookingCount,
      totalSpend,
      rank,
      totalGuests: allGuests.length,
      vipTier,
      bookings: guest.bookings.map((b) => ({
        id: b.id,
        bookingCode: `BK-${b.id.slice(-6).toUpperCase()}`,
        checkIn: b.checkIn.toISOString(),
        checkOut: b.checkOut.toISOString(),
        roomNumber: b.assignedRoom?.roomNumber ?? null,
        status: b.status,
        source: b.source,
        amount: Number(b.totalAmount),
      })),
    };
  }
}
