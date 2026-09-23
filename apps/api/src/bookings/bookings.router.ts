import { z } from 'zod';
import { authedProcedure, router, requireRole } from '../trpc/trpc.js';
import type { BookingsService } from './bookings.service.js';
import { isHousekeeping, redactForHousekeeping } from './redact.js';

const frontDeskUp = requireRole('pms', ['owner', 'manager', 'front_desk']);
const anyPmsRole = requireRole('pms', ['owner', 'manager', 'front_desk', 'housekeeping']);
const ownerOrManager = requireRole('pms', ['owner', 'manager']);

export function createBookingsRouter(bookings: BookingsService) {
  return router({
    createManualBooking: frontDeskUp
      .input(
        z.object({
          hotelId: z.string(),
          guestName: z.string().min(1),
          guestPhone: z.string().regex(/^\d{10}$/).optional(),
          roomCategoryId: z.string(),
          ratePlanId: z.string().optional(),
          checkIn: z.coerce.date(),
          checkOut: z.coerce.date(),
          nights: z.number().int().positive(),
          totalAmount: z.number().nonnegative(),
        }),
      )
      .mutation(({ input }) => bookings.createManualBooking(input)),

    checkInWalkIn: frontDeskUp
      .input(
        z.object({
          hotelId: z.string(),
          roomId: z.string(),
          guestName: z.string().min(1),
          guestPhone: z.string().regex(/^\d{10}$/).optional(),
          ratePlanId: z.string().optional(),
          checkIn: z.coerce.date(),
          checkOut: z.coerce.date(),
          nights: z.number().int().positive(),
          totalAmount: z.number().nonnegative(),
        }),
      )
      .mutation(({ ctx, input }) => bookings.checkInWalkIn({ ...input, actorId: ctx.user.userId })),

    checkInReservation: frontDeskUp
      .input(z.object({ bookingId: z.string(), roomId: z.string() }))
      .mutation(({ ctx, input }) => bookings.checkInReservation({ ...input, actorId: ctx.user.userId })),

    addPayment: frontDeskUp
      .input(z.object({ bookingId: z.string(), amount: z.number().positive(), method: z.enum(['cash', 'online', 'card']) }))
      .mutation(({ ctx, input }) => bookings.addPayment({ ...input, collectedBy: ctx.user.userId })),

    listReservations: anyPmsRole
      .input(z.object({ hotelId: z.string(), from: z.coerce.date().optional(), to: z.coerce.date().optional() }))
      .query(async ({ ctx, input }) => {
        const rows = await bookings.listReservations(input);
        return isHousekeeping(ctx.user.roles.pms) ? rows.map(redactForHousekeeping) : rows;
      }),

    getBooking: anyPmsRole.input(z.object({ bookingId: z.string() })).query(async ({ ctx, input }) => {
      const row = await bookings.getBooking(input.bookingId);
      return isHousekeeping(ctx.user.roles.pms) ? redactForHousekeeping(row) : row;
    }),

    getRoomBoard: anyPmsRole.input(z.object({ hotelId: z.string() })).query(async ({ ctx, input }) => {
      const rows = await bookings.getRoomBoard(input.hotelId);
      if (!isHousekeeping(ctx.user.roles.pms)) return rows;
      return rows.map((r) => ({ ...r, currentStay: r.currentStay ? redactForHousekeeping(r.currentStay) : null }));
    }),

    listInHouse: frontDeskUp.input(z.object({ hotelId: z.string() })).query(({ input }) => bookings.listInHouse(input.hotelId)),

    resolveDelay: ownerOrManager
      .input(z.object({ bookingId: z.string(), note: z.string().min(1) }))
      .mutation(({ ctx, input }) => bookings.resolveDelay({ ...input, resolvedBy: ctx.user.userId })),
  });
}
