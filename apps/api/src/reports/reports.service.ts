import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

function dayKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

function endOfDay(d: Date): Date {
  const end = new Date(d);
  end.setHours(23, 59, 59, 999);
  return end;
}

export interface RoomsReportDay {
  date: string;
  checkIns: number;
  cleanings: number;
  guestCleanings: number;
  checkouts: number;
  discrepancies: number;
  delaysResolved: number;
  cash: number;
  online: number;
  card: number;
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
  cash: number;
  online: number;
  card: number;
  due: number;
  totalSale: number;
  bookings: { id: string; guestName: string; roomNumber: string | null; totalAmount: number; paidAmount: number; due: number }[];
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * §8.8 Rooms Report — check-ins, cleanings, guest cleanings, checkouts,
   * delays, discrepancies, collections by method, daily breakdown, per-room
   * rows. "Automatic checkouts" in the spec's language are, in this product,
   * every Checkout Cleaning (§8.6 — that's the only checkout path there is).
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
        row = { date: key, checkIns: 0, cleanings: 0, guestCleanings: 0, checkouts: 0, discrepancies: 0, delaysResolved: 0, cash: 0, online: 0, card: 0 };
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
      const row = dayRow(dayKey(p.collectedAt));
      row[p.method] += Number(p.amount);
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
   * §8.8 Sale Report — total sale split by Cash/Online/Card/Due, one line per
   * day expanding to room-wise bookings. Revenue counts per booking on its
   * check-in day, never per night (§8.8) — a stay spanning a month boundary
   * is counted once, in the month it checked in.
   */
  async getSaleReport(input: { hotelId: string; month: string }) {
    const start = new Date(`${input.month}-01T00:00:00.000Z`);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);

    const bookings = await this.prisma.booking.findMany({
      where: { hotelId: input.hotelId, checkIn: { gte: start, lt: end }, status: { not: 'cancelled' } },
      include: { payments: true, assignedRoom: true },
      orderBy: { checkIn: 'asc' },
    });

    const days = new Map<string, SaleReportDay>();
    for (const b of bookings) {
      const key = dayKey(b.checkIn);
      let row = days.get(key);
      if (!row) {
        row = { date: key, cash: 0, online: 0, card: 0, due: 0, totalSale: 0, bookings: [] };
        days.set(key, row);
      }

      let cash = 0;
      let online = 0;
      let card = 0;
      for (const p of b.payments) {
        if (p.method === 'cash') cash += Number(p.amount);
        else if (p.method === 'online') online += Number(p.amount);
        else if (p.method === 'card') card += Number(p.amount);
      }
      const paid = Number(b.paidAmount ?? 0);
      const due = Number(b.totalAmount) - paid;

      row.cash += cash;
      row.online += online;
      row.card += card;
      row.due += due;
      row.totalSale += Number(b.totalAmount);
      row.bookings.push({
        id: b.id,
        guestName: b.guestName,
        roomNumber: b.assignedRoom?.roomNumber ?? null,
        totalAmount: Number(b.totalAmount),
        paidAmount: paid,
        due,
      });
    }

    return Array.from(days.values()).sort((a, b) => a.date.localeCompare(b.date));
  }
}
