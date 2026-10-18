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

    updateRatePlan: ownerOrManager
      .input(
        z.object({
          ratePlanId: z.string(),
          name: z.string().min(1).optional(),
          mealPlan: z.string().nullish(),
          isDerived: z.boolean().optional(),
          baseRatePlanId: z.string().nullish(),
          formula: z.string().nullish(),
        }),
      )
      .mutation(({ input }) => rates.updateRatePlan(input)),

    deleteRatePlan: ownerOrManager.input(z.object({ ratePlanId: z.string() })).mutation(({ input }) => rates.deleteRatePlan(input.ratePlanId)),

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

    clearValueOverride: ownerOrManager
      .input(z.object({ ratePlanId: z.string(), otaConnectionId: z.string(), date: z.coerce.date(), occupancyTier: z.number().int().min(1).max(4) }))
      .mutation(async ({ ctx, input }) => {
        const result = await rates.clearValueOverride({ ...input, actorId: ctx.user.userId });
        if (result.cleared) {
          await sync.enqueueRatePush({
            otaConnectionId: input.otaConnectionId,
            ratePlanId: input.ratePlanId,
            startDate: input.date,
            endDate: input.date,
          });
        }
        return result;
      }),

    listActiveOverrides: authedProcedure.input(z.object({ hotelId: z.string() })).query(({ input }) => rates.listActiveOverrides(input.hotelId)),

    listRecentActivity: authedProcedure
      .input(z.object({ hotelId: z.string(), days: z.number().int().positive().max(90).default(30) }))
      .query(({ input }) => rates.listRecentActivity(input.hotelId, input.days)),

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
          // `.nullish()`, not `.optional()` — the form always submits every field, and a
          // field the owner cleared back to blank sends `null` (clear it in the DB), while
          // `undefined` is reserved for "not part of this payload at all" (Prisma leaves an
          // `undefined` field untouched, so `.optional()` alone made a cleared restriction
          // field impossible to actually clear once set).
          minLos: z.number().int().positive().nullish(),
          maxLos: z.number().int().positive().nullish(),
          bookableNights: z.number().int().positive().nullish(),
          minAdvanceDays: z.number().int().nonnegative().nullish(),
          maxAdvanceDays: z.number().int().nonnegative().nullish(),
          // Phase 3 fields, exposed early at user request — columns have existed since day one (§5.1).
          policyOverrideId: z.string().nullish(),
          minLosArrival: z.number().int().positive().nullish(),
          maxLosArrival: z.number().int().positive().nullish(),
          exactLosArrival: z.number().int().positive().nullish(),
          cap: z.number().int().nonnegative().nullish(),
          cutoffHours: z.number().int().nonnegative().nullish(),
          allocationCount: z.number().int().nonnegative().nullish(),
        }),
      )
      .mutation(({ ctx, input }) => rates.upsertRestriction({ ...input, actorId: ctx.user.userId })),

    createRoomBlock: ownerOrManager
      .input(
        z.object({
          hotelId: z.string(),
          roomCategoryId: z.string(),
          startDate: z.coerce.date(),
          endDate: z.coerce.date(),
          roomsBlocked: z.number().int().positive(),
          reason: z.string().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const block = await rates.createRoomBlock({ ...input, actorId: ctx.user.userId });
        const [plans, connections] = await Promise.all([
          rates.listRatePlans(input.roomCategoryId),
          rates.listOtaConnectionIds(input.hotelId),
        ]);
        await Promise.all(
          plans.flatMap((rp) =>
            connections.map((c) =>
              sync.enqueueRatePush({ otaConnectionId: c.id, ratePlanId: rp.id, startDate: input.startDate, endDate: input.endDate }),
            ),
          ),
        );
        return block;
      }),

    releaseRoomBlock: ownerOrManager
      .input(z.object({ roomBlockId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const block = await rates.releaseRoomBlock({ roomBlockId: input.roomBlockId, actorId: ctx.user.userId });
        const [plans, connections] = await Promise.all([
          rates.listRatePlans(block.roomCategoryId),
          rates.listOtaConnectionIds(block.hotelId),
        ]);
        await Promise.all(
          plans.flatMap((rp) =>
            connections.map((c) =>
              sync.enqueueRatePush({ otaConnectionId: c.id, ratePlanId: rp.id, startDate: block.startDate, endDate: block.endDate }),
            ),
          ),
        );
        return block;
      }),

    listRoomBlocks: authedProcedure.input(z.object({ hotelId: z.string() })).query(({ input }) => rates.listRoomBlocks(input.hotelId)),

    getDayNote: authedProcedure
      .input(z.object({ roomCategoryId: z.string(), date: z.coerce.date() }))
      .query(({ input }) => rates.getDayNote(input.roomCategoryId, input.date)),

    getChannelBlockStatus: authedProcedure
      .input(z.object({ ratePlanId: z.string(), date: z.coerce.date() }))
      .query(({ input }) => rates.getChannelBlockStatus(input.ratePlanId, input.date)),

    saveCellEditor: ownerOrManager
      .input(
        z.object({
          hotelId: z.string(),
          roomCategoryId: z.string(),
          ratePlanId: z.string(),
          date: z.coerce.date(),
          price: z.number().nonnegative(),
          availability: z.number().int().nonnegative(),
          blocked: z.boolean(),
          dayNote: z.string(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const result = await rates.saveCellEditor({ ...input, actorId: ctx.user.userId });
        await Promise.all(
          result.connectionIds.map((otaConnectionId) =>
            sync.enqueueRatePush({ otaConnectionId, ratePlanId: input.ratePlanId, startDate: input.date, endDate: input.date }),
          ),
        );
        return result;
      }),

    bulkEditCells: ownerOrManager
      .input(
        z.object({
          hotelId: z.string(),
          roomCategoryIds: z.array(z.string()).min(1),
          startDate: z.coerce.date(),
          endDate: z.coerce.date(),
          daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
          price: z.number().nonnegative(),
          availability: z.number().int().nonnegative(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const result = await rates.bulkEditCells({ ...input, actorId: ctx.user.userId });
        await Promise.all(
          result.ratePlanIds.flatMap((ratePlanId) =>
            result.connectionIds.map((otaConnectionId) =>
              sync.enqueueRatePush({ otaConnectionId, ratePlanId, startDate: input.startDate, endDate: input.endDate }),
            ),
          ),
        );
        return result;
      }),
  });
}
