import { Injectable } from '@nestjs/common';
import { Prisma, RateSource, type InventoryRate, type AuditEventType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { computeGstSlab } from '../common/gst.js';
import { AuditService } from '../common/audit.service.js';

function datesInRange(start: Date, end: Date, daysOfWeek?: number[]): Date[] {
  const dates: Date[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    if (!daysOfWeek || daysOfWeek.includes(cursor.getUTCDay())) dates.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

// price/availability are optional here specifically for bulkUpdate's split
// Rate-Update-vs-Inventory-Update UX — setValueOverride's own form always
// sends both, so this relaxation doesn't change its behavior.
export interface TierSet {
  occupancyTier: number;
  price?: number;
  extraAdultPrice?: number;
  child1Price?: number;
  child2Price?: number;
  availability?: number;
}

@Injectable()
export class RatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Every CM audit event here keys off an otaConnectionId, not a hotelId directly — one lookup to resolve it, non-blocking to the caller's own result. */
  private async logCmEvent(otaConnectionId: string, eventType: AuditEventType, actorId: string, detail?: Prisma.InputJsonObject) {
    const connection = await this.prisma.otaConnection.findUnique({ where: { id: otaConnectionId }, select: { hotelId: true } });
    if (!connection) return;
    await this.audit.log({ hotelId: connection.hotelId, eventType, actorId, detail });
  }

  async createRatePlan(input: {
    roomCategoryId: string;
    name: string;
    mealPlan?: string;
    isDerived?: boolean;
    baseRatePlanId?: string;
    formula?: string;
  }) {
    return this.prisma.ratePlan.create({ data: input });
  }

  async listRatePlans(roomCategoryId: string) {
    return this.prisma.ratePlan.findMany({ where: { roomCategoryId } });
  }

  /** Every rate plan across every room category, for the hotel-wide Rate Update / Inventory Update forms (one row per rate plan, not filtered to a single category first). */
  async listAllRatePlansForHotel(hotelId: string) {
    const plans = await this.prisma.ratePlan.findMany({
      where: { roomCategory: { hotelId } },
      include: { roomCategory: true },
      orderBy: [{ roomCategory: { name: 'asc' } }, { name: 'asc' }],
    });
    return plans.map(({ roomCategory, ...p }) => ({ ...p, roomCategoryName: roomCategory.name }));
  }

  /** The core grid read — every screen's data source (§5.1). Attaches GST slab info per cell. */
  async getGrid(input: { ratePlanId: string; otaConnectionId: string; startDate: Date; endDate: Date }) {
    const [rates, restrictions] = await Promise.all([
      this.prisma.inventoryRate.findMany({
        where: {
          ratePlanId: input.ratePlanId,
          otaConnectionId: input.otaConnectionId,
          date: { gte: input.startDate, lte: input.endDate },
        },
        orderBy: [{ date: 'asc' }, { occupancyTier: 'asc' }],
      }),
      this.prisma.restriction.findMany({
        where: {
          ratePlanId: input.ratePlanId,
          otaConnectionId: input.otaConnectionId,
          date: { gte: input.startDate, lte: input.endDate },
        },
        orderBy: { date: 'asc' },
      }),
    ]);

    return {
      rates: rates.map((r) => ({ ...r, gst: computeGstSlab(Number(r.price)) })),
      restrictions,
    };
  }

  /**
   * Pooled inventory (direct-ota-integration-guide.md's non-negotiable): every
   * physical room in a category is one shared pool, so a booking from ANY
   * source — any OTA, direct, or walk-in — must block that room-night on
   * every channel at once, or two OTAs could sell the same room twice.
   * Applies to every rate plan under the category (they all price the same
   * rooms) and every OTA connection the hotel has, clamped at 0. Pass a
   * negative delta when a stay is booked, positive when it's cancelled.
   * Silently a no-op until both a rate plan and a channel connection exist
   * for the cell in question — nothing to block there yet either way.
   */
  async adjustAvailabilityForStay(input: { hotelId: string; roomCategoryId: string; checkIn: Date; checkOut: Date; delta: number }) {
    const [ratePlans, connections] = await Promise.all([
      this.prisma.ratePlan.findMany({ where: { roomCategoryId: input.roomCategoryId }, select: { id: true } }),
      this.prisma.otaConnection.findMany({ where: { hotelId: input.hotelId }, select: { id: true } }),
    ]);
    if (ratePlans.length === 0 || connections.length === 0) return;

    const nights = datesInRange(input.checkIn, new Date(input.checkOut.getTime() - 86400000));
    if (nights.length === 0) return;

    // Each date param needs an explicit ::date cast — Prisma otherwise binds a JS Date as
    // `timestamp`, which silently matches nothing against this column's `date` type.
    await this.prisma.$executeRaw(Prisma.sql`
      UPDATE inventory_rates
      SET availability = GREATEST(availability + ${input.delta}, 0)
      WHERE rate_plan_id IN (${Prisma.join(ratePlans.map((r) => r.id))})
        AND ota_connection_id IN (${Prisma.join(connections.map((c) => c.id))})
        AND date IN (${Prisma.join(nights.map((n) => Prisma.sql`${n}::date`))})
        AND occupancy_tier = 1
    `);
  }

  /**
   * §7 Phase 1 #3: a genuinely separate write path from Bulk Update. Always
   * wins over a bulk write to the same cell until explicitly overridden (§5.5).
   */
  async setValueOverride(input: {
    ratePlanId: string;
    otaConnectionId: string;
    date: Date;
    tiers: TierSet[];
    changedBy: string;
  }) {
    const result = await this.prisma.$transaction(
      input.tiers.map((tier) =>
        this.prisma.inventoryRate.upsert({
          where: {
            ratePlanId_otaConnectionId_date_occupancyTier: {
              ratePlanId: input.ratePlanId,
              otaConnectionId: input.otaConnectionId,
              date: input.date,
              occupancyTier: tier.occupancyTier,
            },
          },
          create: {
            ratePlanId: input.ratePlanId,
            otaConnectionId: input.otaConnectionId,
            date: input.date,
            occupancyTier: tier.occupancyTier,
            price: tier.price ?? 0,
            extraAdultPrice: tier.extraAdultPrice,
            child1Price: tier.child1Price,
            child2Price: tier.child2Price,
            availability: tier.availability ?? 0,
            source: RateSource.value_override,
            changedBy: input.changedBy,
          },
          update: {
            price: tier.price ?? 0,
            extraAdultPrice: tier.extraAdultPrice,
            child1Price: tier.child1Price,
            child2Price: tier.child2Price,
            availability: tier.availability ?? 0,
            source: RateSource.value_override,
            changedBy: input.changedBy,
            changedAt: new Date(),
          },
        }),
      ),
    );
    await this.logCmEvent(input.otaConnectionId, 'RATE_VALUE_OVERRIDE', input.changedBy, { ratePlanId: input.ratePlanId, date: input.date.toISOString().slice(0, 10) });
    return result;
  }

  /**
   * §7 Phase 1 #2. `explicitTiers` populates cells from scratch (first-time set);
   * `adjust` changes existing prices by %/fixed amount, only where a row already
   * exists. Skips any cell whose current source is value_override unless
   * `overrideValueOverrides` is set (§5.5's design rule).
   */
  async bulkUpdate(input: {
    ratePlanId: string;
    otaConnectionId: string;
    startDate: Date;
    endDate: Date;
    daysOfWeek?: number[]; // 0=Sunday .. 6=Saturday; omit = every day
    explicitTiers?: TierSet[];
    adjust?: { mode: 'percent' | 'fixed'; direction: 'increase' | 'decrease'; value: number };
    overrideValueOverrides?: boolean;
    changedBy: string;
  }) {
    const dates = datesInRange(input.startDate, input.endDate, input.daysOfWeek);
    let updated = 0;
    let skippedValueOverrides = 0;

    for (const date of dates) {
      const existingRows = await this.prisma.inventoryRate.findMany({
        where: { ratePlanId: input.ratePlanId, otaConnectionId: input.otaConnectionId, date },
      });
      const existingByTier = new Map(existingRows.map((r) => [r.occupancyTier, r]));

      if (input.explicitTiers) {
        for (const tier of input.explicitTiers) {
          const existing = existingByTier.get(tier.occupancyTier);
          if (existing?.source === RateSource.value_override && !input.overrideValueOverrides) {
            skippedValueOverrides++;
            continue;
          }
          await this.upsertBulkCell(input.ratePlanId, input.otaConnectionId, date, tier, input.changedBy, existing);
          updated++;
        }
      } else if (input.adjust) {
        for (const existing of existingRows) {
          if (existing.source === RateSource.value_override && !input.overrideValueOverrides) {
            skippedValueOverrides++;
            continue;
          }
          const current = Number(existing.price);
          const delta = input.adjust.mode === 'percent' ? current * (input.adjust.value / 100) : input.adjust.value;
          const newPrice = input.adjust.direction === 'increase' ? current + delta : current - delta;
          await this.prisma.inventoryRate.update({
            where: { id: existing.id },
            data: {
              price: Math.max(0, Math.round(newPrice)),
              source: RateSource.bulk_update,
              changedBy: input.changedBy,
              changedAt: new Date(),
            },
          });
          updated++;
        }
      }
    }

    if (updated > 0) {
      await this.logCmEvent(input.otaConnectionId, 'RATE_BULK_UPDATE', input.changedBy, {
        ratePlanId: input.ratePlanId,
        datesProcessed: dates.length,
        cellsUpdated: updated,
      });
    }
    return { datesProcessed: dates.length, cellsUpdated: updated, cellsSkippedValueOverride: skippedValueOverrides };
  }

  /**
   * Rate Update and Inventory Update are separate pages/actions now (each
   * sends only price+extras, or only availability) — merges whichever half
   * is omitted from the existing row rather than clobbering it. A brand-new
   * cell with no existing row and no value for a required field defaults
   * to 0, which is deliberately visible/wrong so the owner notices and fixes
   * it via the other page, rather than silently refusing to create the row.
   */
  private async upsertBulkCell(
    ratePlanId: string,
    otaConnectionId: string,
    date: Date,
    tier: TierSet,
    changedBy: string,
    existing?: InventoryRate,
  ) {
    const price = tier.price ?? existing?.price ?? 0;
    const availability = tier.availability ?? existing?.availability ?? 0;
    const extraAdultPrice = tier.extraAdultPrice ?? existing?.extraAdultPrice ?? undefined;
    const child1Price = tier.child1Price ?? existing?.child1Price ?? undefined;
    const child2Price = tier.child2Price ?? existing?.child2Price ?? undefined;

    return this.prisma.inventoryRate.upsert({
      where: {
        ratePlanId_otaConnectionId_date_occupancyTier: { ratePlanId, otaConnectionId, date, occupancyTier: tier.occupancyTier },
      },
      create: {
        ratePlanId,
        otaConnectionId,
        date,
        occupancyTier: tier.occupancyTier,
        price,
        extraAdultPrice,
        child1Price,
        child2Price,
        availability,
        source: RateSource.bulk_update,
        changedBy,
      },
      update: {
        price,
        extraAdultPrice,
        child1Price,
        child2Price,
        availability,
        source: RateSource.bulk_update,
        changedBy,
        changedAt: new Date(),
      },
    });
  }

  /** §7 Phase 1 #15 — CSV export of the grid for one rate plan/channel/date range. */
  async exportGridCsv(input: { ratePlanId: string; otaConnectionId: string; startDate: Date; endDate: Date }) {
    const rates = await this.prisma.inventoryRate.findMany({
      where: {
        ratePlanId: input.ratePlanId,
        otaConnectionId: input.otaConnectionId,
        date: { gte: input.startDate, lte: input.endDate },
      },
      orderBy: [{ date: 'asc' }, { occupancyTier: 'asc' }],
    });

    const header = 'date,occupancy_tier,price,extra_adult_price,child_1_price,child_2_price,availability,source,gst_label';
    const rows = rates.map((r) => {
      const gst = computeGstSlab(Number(r.price));
      return [
        r.date.toISOString().slice(0, 10),
        r.occupancyTier,
        r.price,
        r.extraAdultPrice ?? '',
        r.child1Price ?? '',
        r.child2Price ?? '',
        r.availability,
        r.source,
        gst.label,
      ].join(',');
    });
    return [header, ...rows].join('\n');
  }

  async upsertRestriction(
    input: {
      ratePlanId: string;
      otaConnectionId: string;
      date: Date;
      actorId: string;
    } & Partial<
      Omit<Prisma.RestrictionUncheckedCreateInput, 'ratePlanId' | 'otaConnectionId' | 'date' | 'id'>
    >,
  ) {
    const { ratePlanId, otaConnectionId, date, actorId, ...fields } = input;
    const result = await this.prisma.restriction.upsert({
      where: { ratePlanId_otaConnectionId_date: { ratePlanId, otaConnectionId, date } },
      create: { ratePlanId, otaConnectionId, date, ...fields },
      update: fields,
    });
    await this.logCmEvent(otaConnectionId, 'RESTRICTION_UPDATED', actorId, { ratePlanId, date: date.toISOString().slice(0, 10) });
    return result;
  }
}
