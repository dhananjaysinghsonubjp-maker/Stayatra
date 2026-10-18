import { z } from 'zod';
import { router, requireRole, authedProcedure } from '../trpc/trpc.js';
import type { StaffService } from './staff.service.js';

const ownerOrManager = requireRole('pms', ['owner', 'manager']);
const ownerOnly = requireRole('pms', ['owner']);

export function createStaffRouter(staff: StaffService) {
  return router({
    myProfile: authedProcedure.query(({ ctx }) => staff.myProfile(ctx.user.userId)),

    propose: ownerOrManager
      .input(
        z.object({
          hotelId: z.string(),
          name: z.string().min(1),
          role: z.enum(['manager', 'housekeeping']),
          designation: z.string().optional(),
          shift: z.string().optional(),
          phone: z.string().optional(),
          photoPath: z.string().optional(),
          idNumber: z.string().optional(),
          idPhotoPath: z.string().optional(),
        }),
      )
      .mutation(({ ctx, input }) =>
        staff.propose({ ...input, proposedBy: ctx.user.userId, proposerIsOwner: ctx.user.roles.pms === 'owner' }),
      ),

    // §user request — "FMO ko staff list bhi dikhegi": owner+manager can both see the roster,
    // approve/reject/PIN-mint/remove/edit stay ownerOnly below (confirmed explicitly).
    listAll: ownerOrManager.input(z.object({ hotelId: z.string() })).query(({ input }) => staff.listAll(input.hotelId)),

    approve: ownerOnly
      .input(z.object({ userId: z.string() }))
      .mutation(({ ctx, input }) => staff.approve({ userId: input.userId, resolvedBy: ctx.user.userId })),

    reject: ownerOnly
      .input(z.object({ userId: z.string(), note: z.string().min(1) }))
      .mutation(({ ctx, input }) => staff.reject({ ...input, resolvedBy: ctx.user.userId })),

    updateProfile: ownerOnly
      .input(
        z.object({
          userId: z.string(),
          name: z.string().min(1).optional(),
          phone: z.string().optional(),
          photoPath: z.string().optional(),
          idNumber: z.string().optional(),
          idPhotoPath: z.string().optional(),
          designation: z.string().optional(),
          shift: z.string().optional(),
          role: z.enum(['manager', 'housekeeping']).optional(),
        }),
      )
      .mutation(({ input }) => staff.updateProfile(input)),

    setPin: ownerOnly
      .input(z.object({ userId: z.string(), pin: z.string().length(4) }))
      .mutation(({ ctx, input }) => staff.setPin({ ...input, setBy: ctx.user.userId })),

    remove: ownerOnly
      .input(z.object({ userId: z.string() }))
      .mutation(({ ctx, input }) => staff.remove({ userId: input.userId, removedBy: ctx.user.userId })),
  });
}
