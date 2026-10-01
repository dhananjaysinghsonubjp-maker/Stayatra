import { z } from 'zod';
import { authedProcedure, router, requireRole } from '../trpc/trpc.js';
import type { RatesService } from './rates.service.js';
import type { OtaSyncService } from '../sync/ota-sync.service.js';

const ownerOrManager = requireRole('channel_manager', ['owner', 'manager']);

// Value Override always sets a whole cell at once — price and availability stay required there.
const overrideTierSetSchema = z.object({
  occupancyTier: z.number().int().min(1).max(4),
  price: z.number().nonnegative(),
  extraAdultPrice: z.number().nonnegative().optional(),
  child1Price: z.number().nonnegative().optional(),
  child2Price: z.number().nonnegative().optional(),
  availability: z.number().int().nonnegative(),
});

// Bulk Update is split into separate Rate Update / Inventory Update pages
// (each sends only its own half) — both optional here, but at least one of
// the two must be present or the write is meaningless.
const bulkTierSetSchema = z
  .object({
    occupancyTier: z.number().int().min(1).max(4),
    price: z.number().nonnegative().optional(),
    extraAdultPrice: z.number().nonnegative().optional(),
    child1Price: z.number().nonnegative().optional(),
    child2Price: z.number().nonnegative().optional(),
    availability: z.number().int().nonnegative().optional(),
  })
  .refine((t) => t.price !== undefined || t.availability !== undefined, {
    message: 'At least one of price or availability must be set',
  });

export function createRatesRouter(rates: RatesService, sync: OtaSyncService) {
  return router({
    createRatePlan: ownerOrManager
      .input(
        z.object({
          roomCategoryId: z.string(),
          name: z.string().min(1),
          mealPlan: z.string().optional(),
          isDerived: z.boolean().optional(),
          baseRatePlanId: z.string().optional(),
          formula: z.string().optional(),
        }),
      )
      .mutation(({ input }) => rates.createRatePlan(input)),

    listRatePlans: authedProcedure
      .input(z.object({ roomCategoryId: z.string() }))
      .query(({ input }) => rates.listRatePlans(input.roomCategoryId)),

    listAllRatePlansForHotel: authedProcedure
      .input(z.object({ hotelId: z.string() }))
      .query(({ input }) => rates.listAllRatePlansForHotel(input.hotelId)),

    getGrid: authedProcedure
      .input(
        z.object({
          ratePlanId: z.string(),
          otaConnectionId: z.string(),
          startDate: z.coerce.date(),
          endDate: z.coerce.date(),
        }),
      )
      .query(({ input }) => rates.getGrid(input)),

    setValueOverride: ownerOrManager
      .input(
        z.object({
          ratePlanId: z.string(),
          otaConnectionId: z.string(),
          date: z.coerce.date(),
          tiers: z.array(overrideTierSetSchema).min(1),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const result = await rates.setValueOverride({ ...input, changedBy: ctx.user.userId });
        await sync.enqueueRatePush({
          otaConnectionId: input.otaConnectionId,
          ratePlanId: input.ratePlanId,
          startDate: input.date,
          endDate: input.date,
        });
        return result;
      }),

    bulkUpdate: ownerOrManager
      .input(
        z.object({
          ratePlanId: z.string(),
          otaConnectionId: z.string(),
          startDate: z.coerce.date(),
          endDate: z.coerce.date(),
          daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
          explicitTiers: z.array(bulkTierSetSchema).optional(),
          adjust: z
            .object({
              mode: z.enum(['percent', 'fixed']),
              direction: z.enum(['increase', 'decrease']),
              value: z.number().positive(),
            })
            .optional(),
          overrideValueOverrides: z.boolean().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const result = await rates.bulkUpdate({ ...input, changedBy: ctx.user.userId });
        await sync.enqueueRatePush({
          otaConnectionId: input.otaConnectionId,
          ratePlanId: input.ratePlanId,
          startDate: input.startDate,
          endDate: input.endDate,
        });
        return result;
      }),

    exportGridCsv: authedProcedure
      .input(
        z.object({
          ratePlanId: z.string(),
          otaConnectionId: z.string(),
          startDate: z.coerce.date(),
          endDate: z.coerce.date(),
        }),
      )
      .query(({ input }) => rates.exportGridCsv(input)),

    upsertRestriction: ownerOrManager
      .input(
        z.object({
          ratePlanId: z.string(),
          otaConnectionId: z.string(),
          date: z.coerce.date(),
          channelBlocked: z.boolean().optional(),
          ratePlanClosed: z.boolean().optional(),
          closedToArrival: z.boolean().optional(),
          closedToDeparture: z.boolean().optional(),
          minLos: z.number().int().positive().optional(),
          maxLos: z.number().int().positive().optional(),
          bookableNights: z.number().int().positive().optional(),
          minAdvanceDays: z.number().int().nonnegative().optional(),
          maxAdvanceDays: z.number().int().nonnegative().optional(),
          // Phase 3 fields, exposed early at user request — columns have existed since day one (§5.1).
          policyOverrideId: z.string().optional(),
          minLosArrival: z.number().int().positive().optional(),
          maxLosArrival: z.number().int().positive().optional(),
          exactLosArrival: z.number().int().positive().optional(),
          cap: z.number().int().nonnegative().optional(),
          cutoffHours: z.number().int().nonnegative().optional(),
          allocationCount: z.number().int().nonnegative().optional(),
        }),
      )
      .mutation(({ ctx, input }) => rates.upsertRestriction({ ...input, actorId: ctx.user.userId })),
  });
}
