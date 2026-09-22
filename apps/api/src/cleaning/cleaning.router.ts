import { z } from 'zod';
import { router, requireRole } from '../trpc/trpc.js';
import type { CleaningService } from './cleaning.service.js';
import { isHousekeeping } from '../bookings/redact.js';

const housekeepingUp = requireRole('pms', ['owner', 'manager', 'housekeeping']);
const ownerOrManager = requireRole('pms', ['owner', 'manager']);
const anyPmsRole = requireRole('pms', ['owner', 'manager', 'front_desk', 'housekeeping']);

export function createCleaningRouter(cleaning: CleaningService) {
  return router({
    submit: housekeepingUp
      .input(
        z.object({
          id: z.string().optional(),
          hotelId: z.string(),
          roomId: z.string(),
          kind: z.enum(['checkout', 'guest_stay']),
          primaryHousekeeperId: z.string(),
          secondHousekeeperId: z.string().optional(),
          photos: z.array(z.string()).min(1),
        }),
      )
      .mutation(({ ctx, input }) => cleaning.submitCleaning({ ...input, actorId: ctx.user.userId })),

    resolveDiscrepancy: ownerOrManager
      .input(z.object({ cleaningRecordId: z.string(), note: z.string().min(1) }))
      .mutation(({ ctx, input }) => cleaning.resolveDiscrepancy({ ...input, resolvedBy: ctx.user.userId })),

    list: anyPmsRole
      .input(z.object({ hotelId: z.string(), roomId: z.string().optional(), flaggedOnly: z.boolean().optional() }))
      .query(async ({ ctx, input }) => {
        const rows = await cleaning.listCleaningRecords(input);
        if (!isHousekeeping(ctx.user.roles.pms)) return rows;
        return rows.map((r) => ({ ...r, resolvedNote: null })); // note hidden from housekeeping (§8.7)
      }),
  });
}
