import { Injectable } from '@nestjs/common';
import type { PaymentMethod } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

/** §user request — a sensible starting chart of accounts for OUR context (no restaurant/kitchen
 * module, unlike DigiStay's reference list) — a hotel can rename/add/remove from here afterward. */
const DEFAULT_CATEGORIES = ['Utility', 'Payroll', 'Maintenance & Repairs', 'Supplies', 'Marketing', 'Other'];

/**
 * §user request — "Ledger / Chart of Accounts". Guest payments (already in `Payment`, tied to a
 * booking) are never copied into `LedgerEntry` — they're merged into the transaction list at read
 * time, tagged "Room", so there's nothing to keep in sync if a payment is edited/deleted later.
 * Petty cash is a plain boolean tag on an entry, not a separate fund/table — the summary just
 * nets isPettyCash entries into their own running total alongside the main balance.
 */
@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async listCategories(hotelId: string) {
    await this.ensureDefaultCategories(hotelId);
    return this.prisma.ledgerCategory.findMany({ where: { hotelId }, orderBy: { name: 'asc' } });
  }

  private async ensureDefaultCategories(hotelId: string) {
    const existing = await this.prisma.ledgerCategory.count({ where: { hotelId } });
    if (existing > 0) return;
    await this.prisma.ledgerCategory.createMany({ data: DEFAULT_CATEGORIES.map((name) => ({ hotelId, name })) });
  }

  async createCategory(input: { hotelId: string; name: string; parentId?: string }) {
    return this.prisma.ledgerCategory.create({ data: input });
  }

  async deleteCategory(categoryId: string) {
    // LedgerEntry.categoryId has onDelete: SetNull, so existing entries just lose their tag
    // rather than blocking the delete or cascading — a removed category shouldn't erase history.
    return this.prisma.ledgerCategory.delete({ where: { id: categoryId } });
  }

  async createEntry(input: {
    hotelId: string;
    type: 'cash_in' | 'cash_out';
    amount: number;
    paymentMethod: PaymentMethod;
    categoryId?: string;
    remarks?: string;
    isPettyCash?: boolean;
    actorId: string;
  }) {
    return this.prisma.ledgerEntry.create({
      data: {
        hotelId: input.hotelId,
        type: input.type,
        amount: input.amount,
        paymentMethod: input.paymentMethod,
        categoryId: input.categoryId,
        remarks: input.remarks,
        isPettyCash: input.isPettyCash ?? false,
        createdBy: input.actorId,
      },
    });
  }

  async deleteEntry(entryId: string) {
    return this.prisma.ledgerEntry.delete({ where: { id: entryId } });
  }

  async setOpeningBalance(hotelId: string, amount: number | null, date: Date | null) {
    return this.prisma.hotel.update({ where: { id: hotelId }, data: { ledgerOpeningBalance: amount, ledgerOpeningDate: date } });
  }

  /** The merged view a hotel actually scrolls through — manual entries + guest payments, newest
   * first. Guest payments show as a read-only "Room" row; only real LedgerEntry rows carry an id
   * that `deleteEntry` can act on (the frontend disables delete for `kind: 'payment'` rows). */
  async listTransactions(input: { hotelId: string; from?: Date; to?: Date }) {
    const dateFilter = input.from || input.to ? { gte: input.from, lte: input.to } : undefined;

    const [entries, payments] = await Promise.all([
      this.prisma.ledgerEntry.findMany({
        where: { hotelId: input.hotelId, ...(dateFilter ? { createdAt: dateFilter } : {}) },
        include: { category: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.payment.findMany({
        where: { booking: { hotelId: input.hotelId }, ...(dateFilter ? { collectedAt: dateFilter } : {}) },
        include: { booking: { select: { id: true, guestName: true } } },
        orderBy: { collectedAt: 'desc' },
      }),
    ]);

    const merged = [
      ...entries.map((e) => ({
        id: e.id,
        kind: 'ledger' as const,
        type: e.type,
        amount: Number(e.amount),
        paymentMethod: e.paymentMethod,
        category: e.category?.name ?? null,
        remarks: e.remarks,
        isPettyCash: e.isPettyCash,
        createdAt: e.createdAt,
        bookingId: null as string | null,
        guestName: null as string | null,
      })),
      ...payments.map((p) => ({
        id: p.id,
        kind: 'payment' as const,
        type: 'cash_in' as const,
        amount: Number(p.amount),
        paymentMethod: p.method,
        category: 'Room',
        remarks: null as string | null,
        isPettyCash: false,
        createdAt: p.collectedAt,
        bookingId: p.booking.id,
        guestName: p.booking.guestName,
      })),
    ];
    merged.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return merged;
  }

  /** Opening balance + everything dated on/after `ledgerOpeningDate` (transactions before that are
   * assumed baked into the opening figure, not recounted) — by payment mode, cash in/out totals,
   * and the petty-cash sub-total. */
  async getSummary(hotelId: string) {
    const hotel = await this.prisma.hotel.findUniqueOrThrow({
      where: { id: hotelId },
      select: { ledgerOpeningBalance: true, ledgerOpeningDate: true },
    });
    const since = hotel.ledgerOpeningDate ?? undefined;

    const [entries, payments] = await Promise.all([
      this.prisma.ledgerEntry.findMany({ where: { hotelId, ...(since ? { createdAt: { gte: since } } : {}) } }),
      this.prisma.payment.findMany({ where: { booking: { hotelId }, ...(since ? { collectedAt: { gte: since } } : {}) } }),
    ]);

    const byMode: Record<string, number> = {};
    const add = (mode: string, delta: number) => {
      byMode[mode] = (byMode[mode] ?? 0) + delta;
    };

    let cashIn = 0;
    let cashOut = 0;
    let pettyCashBalance = 0;
    for (const e of entries) {
      const amt = Number(e.amount);
      if (e.type === 'cash_in') {
        cashIn += amt;
        add(e.paymentMethod, amt);
        if (e.isPettyCash) pettyCashBalance += amt;
      } else {
        cashOut += amt;
        add(e.paymentMethod, -amt);
        if (e.isPettyCash) pettyCashBalance -= amt;
      }
    }
    for (const p of payments) {
      const amt = Number(p.amount);
      cashIn += amt;
      add(p.method, amt);
    }

    const opening = Number(hotel.ledgerOpeningBalance ?? 0);
    return { balance: opening + cashIn - cashOut, cashIn, cashOut, byMode, pettyCashBalance, opening };
  }
}
