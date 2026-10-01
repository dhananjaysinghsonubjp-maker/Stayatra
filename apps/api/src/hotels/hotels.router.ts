import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { authedProcedure, router, requireRole } from '../trpc/trpc.js';
import type { HotelsService } from './hotels.service.js';

const ownerOrManager = requireRole('pms', ['owner', 'manager']);

/**
 * `Hotel` and `RoomCategory` are shared by both modules (§5.1/§5.3 — a
 * Channel-Manager-only org still needs a property to scope room categories/
 * rate plans/OTA connections to, it just never touches physical `rooms`).
 * Gating hotel/category creation behind PMS alone meant a CM-only plan
 * (§5.4 — added beyond MD spec, every module sold separately) could sign up
 * and then hit FORBIDDEN on step one of onboarding. This accepts owner/manager
 * on either module; the genuinely PMS-only endpoints below (physical rooms,
 * staff PINs) stay on the plain PMS-only guard.
 */
const ownerOrManagerAnyModule = authedProcedure.use(({ ctx, next }) => {
  const pmsRole = ctx.user.roles.pms;
  const cmRole = ctx.user.roles.channel_manager;
  const allowed = ['owner', 'manager'];
  if (!allowed.includes(pmsRole ?? '') && !allowed.includes(cmRole ?? '')) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Requires owner/manager on PMS or Channel Manager' });
  }
  return next();
});

export function createHotelsRouter(hotels: HotelsService) {
  return router({
    create: ownerOrManagerAnyModule
      .input(
        z.object({
          name: z.string().min(1),
          city: z.string().optional(),
          gstRegistration: z.string().optional(),
          expectedRoomCount: z.number().int().positive().optional(),
          expectedStaffCount: z.number().int().positive().optional(),
          dpdpConsent: z.boolean(),
        }),
      )
      .mutation(({ ctx, input }) => hotels.createHotel({ organizationId: ctx.user.organizationId, ...input })),

    list: authedProcedure.query(({ ctx }) => hotels.listHotels(ctx.user.organizationId)),

    get: authedProcedure.input(z.object({ hotelId: z.string() })).query(({ input }) => hotels.getHotel(input.hotelId)),

    createRoomCategory: ownerOrManagerAnyModule
      .input(z.object({ hotelId: z.string(), name: z.string().min(1) }))
      .mutation(({ input }) => hotels.createRoomCategory(input)),

    listRoomCategories: authedProcedure
      .input(z.object({ hotelId: z.string() }))
      .query(({ input }) => hotels.listRoomCategories(input.hotelId)),

    generatePlaceholderRooms: ownerOrManager
      .input(z.object({ hotelId: z.string(), count: z.number().int().positive() }))
      .mutation(({ input }) => hotels.generatePlaceholderRooms(input)),

    assignRoomCategory: ownerOrManager
      .input(z.object({ roomId: z.string(), roomCategoryId: z.string().nullable() }))
      .mutation(({ input }) => hotels.assignRoomCategory(input)),

    renameRoom: ownerOrManager
      .input(z.object({ roomId: z.string(), roomNumber: z.string().min(1) }))
      .mutation(({ input }) => hotels.renameRoom(input)),

    addRoom: ownerOrManager
      .input(z.object({ hotelId: z.string(), roomNumber: z.string().min(1), roomCategoryId: z.string().nullable().optional() }))
      .mutation(({ input }) => hotels.addRoom(input)),

    deleteRoom: ownerOrManager.input(z.object({ roomId: z.string() })).mutation(({ input }) => hotels.deleteRoom(input)),

    listRooms: authedProcedure.input(z.object({ hotelId: z.string() })).query(({ input }) => hotels.listRooms(input.hotelId)),

    listStaff: ownerOrManager.input(z.object({ hotelId: z.string() })).query(({ input }) => hotels.listStaff(input.hotelId)),
  });
}
