import { Injectable } from '@nestjs/common';
import { Prisma, RateSource } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { computeGstSlab } from '../common/gst.js';

function datesInRange(start: Date, end: Date, daysOfWeek?: number[]): Date[] {
  const dates: Date[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    if (!daysOfWeek || daysOfWeek.includes(cursor.getUTCDay())) dates.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export interface TierSet {
  occupancyTier: number;
  price: number;
  extraAdultPrice?: number;
  child1Price?: number;
  child2Price?: number;
  availability: number;
}

@Injectable()
export class RatesService {
  constructor(private readonly prisma: PrismaService) {}

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
    return this.prisma.$transaction(
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
            price: tier.price,
            extraAdultPrice: tier.extraAdultPrice,
            child1Price: tier.child1Price,
            child2Price: tier.child2Price,
            availability: tier.availability,
            source: RateSource.value_override,
            changedBy: input.changedBy,
          },
          update: {
            price: tier.price,
            extraAdultPrice: tier.extraAdultPrice,
            child1Price: tier.child1Price,
            child2Price: tier.child2Price,
            availability: tier.availability,
            source: RateSource.value_override,
            changedBy: input.changedBy,
            changedAt: new Date(),
          },
        }),
      ),
    );
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
          await this.upsertBulkCell(input.ratePlanId, input.otaConnectionId, date, tier, input.changedBy);
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

    return { datesProcessed: dates.length, cellsUpdated: updated, cellsSkippedValueOverride: skippedValueOverrides };
  }

  private async upsertBulkCell(
    ratePlanId: string,
    otaConnectionId: string,
    date: Date,
    tier: TierSet,
    changedBy: string,
  ) {
    return this.prisma.inventoryRate.upsert({
      where: {
        ratePlanId_otaConnectionId_date_occupancyTier: { ratePlanId, otaConnectionId, date, occupancyTier: tier.occupancyTier },
      },
      create: {
        ratePlanId,
        otaConnectionId,
        date,
        occupancyTier: tier.occupancyTier,
        price: tier.price,
        extraAdultPrice: tier.extraAdultPrice,
        child1Price: tier.child1Price,
        child2Price: tier.child2Price,
        availability: tier.availability,
        source: RateSource.bulk_update,
        changedBy,
      },
      update: {
        price: tier.price,
        extraAdultPrice: tier.extraAdultPrice,
        child1Price: tier.child1Price,
        child2Price: tier.child2Price,
        availability: tier.availability,
        source: RateSource.bulk_update,
        changedBy,
        changedAt: new Date(),
      },
    });
  }

  async upsertRestriction(
    input: {
      ratePlanId: string;
      otaConnectionId: string;
      date: Date;
    } & Partial<
      Omit<Prisma.RestrictionUncheckedCreateInput, 'ratePlanId' | 'otaConnectionId' | 'date' | 'id'>
    >,
  ) {
    const { ratePlanId, otaConnectionId, date, ...fields } = input;
    return this.prisma.restriction.upsert({
      where: { ratePlanId_otaConnectionId_date: { ratePlanId, otaConnectionId, date } },
      create: { ratePlanId, otaConnectionId, date, ...fields },
      update: fields,
    });
  }
}
