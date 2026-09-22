import { z } from 'zod';
import { authedProcedure, router, requireRole } from '../trpc/trpc.js';
import type { HotelsService } from './hotels.service.js';

const ownerOrManager = requireRole('pms', ['owner', 'manager']);

export function createHotelsRouter(hotels: HotelsService) {
  return router({
    create: ownerOrManager
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

    createRoomCategory: ownerOrManager
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

    listRooms: authedProcedure.input(z.object({ hotelId: z.string() })).query(({ input }) => hotels.listRooms(input.hotelId)),
  });
}
