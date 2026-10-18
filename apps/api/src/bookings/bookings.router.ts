import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { authedProcedure, router, requireRole } from '../trpc/trpc.js';
import type { BookingsService } from './bookings.service.js';
import { isHousekeeping, redactForHousekeeping } from './redact.js';

const frontDeskUp = requireRole('pms', ['owner', 'manager', 'front_desk']);
const anyPmsRole = requireRole('pms', ['owner', 'manager', 'front_desk', 'housekeeping']);
const ownerOrManager = requireRole('pms', ['owner', 'manager']);

const otaCodeSchema = z.enum(['mmt_goibibo', 'booking_com', 'agoda', 'cleartrip', 'expedia', 'airbnb', 'easemytrip', 'yatra']);
const bookingSourceSchema = z.enum(['mmt_goibibo', 'booking_com', 'agoda', 'cleartrip', 'expedia', 'airbnb', 'easemytrip', 'yatra', 'direct', 'walk_in']);

// Reservations are Channel-Manager content too (§7 Phase 1 #5) — a CM-only
// org has no PMS roles at all, so gating this on anyPmsRole alone (as it
// used to be) locked every CM-only tenant out of its own reservations list.
const reservationsReader = authedProcedure.use(({ ctx, next }) => {
  const pmsRole = ctx.user.roles.pms;
  const cmRole = ctx.user.roles.channel_manager;
  const pmsAllowed = ['owner', 'manager', 'front_desk', 'housekeeping'];
  const cmAllowed = ['owner', 'manager'];
  if (!pmsAllowed.includes(pmsRole ?? '') && !cmAllowed.includes(cmRole ?? '')) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Requires a PMS role or Channel Manager owner/manager' });
  }
  return next();
});
const reservationsManager = authedProcedure.use(({ ctx, next }) => {
  const pmsRole = ctx.user.roles.pms;
  const cmRole = ctx.user.roles.channel_manager;
  const allowed = ['owner', 'manager'];
  if (!allowed.includes(pmsRole ?? '') && !allowed.includes(cmRole ?? '')) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Requires owner/manager on PMS or Channel Manager' });
  }
  return next();
});

const idTypeSchema = z.enum(['aadhaar', 'passport', 'driving_license', 'voter_id', 'other']);
const genderSchema = z.enum(['male', 'female', 'other', 'prefer_not_to_say']);
const paymentMethodSchema = z.enum([
  'cash',
  'online',
  'card',
  'bank_transfer',
  'company_settlement',
  'agent_settlement',
  'upi',
  'credit_sale',
  'cheque',
  'cash_deposit',
]);
const paymentDetailsSchema = z.object({
  amount: z.number().positive(),
  method: paymentMethodSchema,
  referenceNumber: z.string().optional(),
  receiptPhotoPath: z.string().optional(),
  collectedAt: z.coerce.date().optional(),
});
const paymentAtCheckInSchema = paymentDetailsSchema.optional();

const lineItemsAtCheckInSchema = z
  .array(z.object({ description: z.string().min(1), quantity: z.number().int().positive(), unitPrice: z.number().nonnegative() }))
  .optional();

const guestDetailsSchema = {
  guestId: z.string().optional(),
  title: z.string().optional(),
  guestName: z.string().min(1),
  guestPhone: z.string().regex(/^\d{10}$/).optional(),
  email: z.string().email().optional(),
  gender: genderSchema.optional(),
  dateOfBirth: z.coerce.date().optional(),
  address: z.string().optional(),
  country: z.string().optional(),
  state: z.string().optional(),
  city: z.string().optional(),
  pincode: z.string().optional(),
  idType: idTypeSchema,
  idNumber: z.string().min(1),
  idPhotoPath: z.string().optional(),
  purposeOfStay: z.string().optional(),
};

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
          nights: z.number().int().positive().max(365),
          totalAmount: z.number().nonnegative(),
        }),
      )
      .mutation(({ input }) => bookings.createManualBooking(input)),

    /** §user request — the multi-room Create Reservation flow's own room-number picker grid. */
    listRoomsWithAvailability: frontDeskUp
      .input(z.object({ hotelId: z.string(), checkIn: z.coerce.date(), checkOut: z.coerce.date() }))
      .query(({ input }) => bookings.listRoomsWithAvailability(input)),

    createMultiRoomReservation: frontDeskUp
      .input(
        z.object({
          hotelId: z.string(),
          source: bookingSourceSchema,
          checkIn: z.coerce.date(),
          checkOut: z.coerce.date(),
          guestName: z.string().min(1),
          guestPhone: z.string().regex(/^\d{10}$/).optional(),
          guestEmail: z.string().email().optional(),
          specialRequest: z.string().optional(),
          rooms: z
            .array(
              z.object({
                roomId: z.string(),
                totalAmount: z.number().nonnegative(),
                ratePlanId: z.string().optional(),
                discountAmount: z.number().nonnegative().optional(),
                gstExempt: z.boolean().optional(),
                lineItems: lineItemsAtCheckInSchema,
              }),
            )
            .min(1),
          advanceAmount: z.number().nonnegative().optional(),
          paymentMethod: paymentMethodSchema.optional(),
        }),
      )
      .mutation(({ ctx, input }) => bookings.createMultiRoomReservation({ ...input, actorId: ctx.user.userId })),

    checkInWalkIn: frontDeskUp
      .input(
        z.object({
          hotelId: z.string(),
          roomId: z.string(),
          ...guestDetailsSchema,
          ratePlanId: z.string().optional(),
          checkIn: z.coerce.date(),
          checkOut: z.coerce.date(),
          nights: z.number().int().positive().max(365),
          totalAmount: z.number().nonnegative(),
          lineItems: lineItemsAtCheckInSchema,
          discountAmount: z.number().nonnegative().optional(),
          gstExempt: z.boolean().optional(),
          payment: paymentAtCheckInSchema,
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { payment, ...rest } = input;
        const booking = await bookings.checkInWalkIn({ ...rest, actorId: ctx.user.userId });
        if (!payment) return { booking, payment: null };
        const result = await bookings.addPayment({ bookingId: booking.id, ...payment, collectedBy: ctx.user.userId });
        return { booking: result.booking, payment: result.payment };
      }),

    checkInReservation: frontDeskUp
      .input(
        z.object({
          bookingId: z.string(),
          roomId: z.string(),
          ...guestDetailsSchema,
          lineItems: lineItemsAtCheckInSchema,
          discountAmount: z.number().nonnegative().optional(),
          gstExempt: z.boolean().optional(),
          payment: paymentAtCheckInSchema,
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { payment, ...rest } = input;
        const booking = await bookings.checkInReservation({ ...rest, actorId: ctx.user.userId });
        if (!payment) return { booking, payment: null };
        const result = await bookings.addPayment({ bookingId: booking.id, ...payment, collectedBy: ctx.user.userId });
        return { booking: result.booking, payment: result.payment };
      }),

    /** §user request — the explicit FMO/GM "Check-out Guest" step; see bookings.service.ts. */
    checkOutGuest: frontDeskUp
      .input(z.object({ hotelId: z.string(), bookingId: z.string() }))
      .mutation(({ ctx, input }) => bookings.checkOutGuest({ ...input, actorId: ctx.user.userId })),

    listUpcomingReservations: frontDeskUp
      .input(z.object({ hotelId: z.string(), roomCategoryId: z.string().optional() }))
      .query(({ input }) => bookings.listUpcomingReservations(input)),

    addPayment: frontDeskUp
      .input(z.object({ bookingId: z.string() }).merge(paymentDetailsSchema))
      .mutation(({ ctx, input }) => bookings.addPayment({ ...input, collectedBy: ctx.user.userId })),

    addLineItem: frontDeskUp
      .input(z.object({ bookingId: z.string(), description: z.string().min(1), quantity: z.number().int().positive(), unitPrice: z.number().nonnegative() }))
      .mutation(({ ctx, input }) => bookings.addLineItem({ ...input, actorId: ctx.user.userId })),

    removeLineItem: frontDeskUp
      .input(z.object({ lineItemId: z.string() }))
      .mutation(({ ctx, input }) => bookings.removeLineItem({ ...input, actorId: ctx.user.userId })),

    setInvoiceSettings: ownerOrManager
      .input(z.object({ bookingId: z.string(), discountAmount: z.number().nonnegative().nullable().optional(), gstExempt: z.boolean().optional() }))
      .mutation(({ ctx, input }) => bookings.setInvoiceSettings({ ...input, actorId: ctx.user.userId })),

    getInvoice: anyPmsRole.input(z.object({ bookingId: z.string() })).query(({ input }) => bookings.getInvoice(input.bookingId)),

    listReservations: reservationsReader
      .input(z.object({ hotelId: z.string(), from: z.coerce.date().optional(), to: z.coerce.date().optional(), otaConnectionId: z.string().optional() }))
      .query(async ({ ctx, input }) => {
        const rows = await bookings.listReservations(input);
        return isHousekeeping(ctx.user.roles.pms) ? rows.map(redactForHousekeeping) : rows;
      }),

    importHistoricalBookings: reservationsManager
      .input(
        z.object({
          hotelId: z.string(),
          otaConnectionId: z.string(),
          source: otaCodeSchema,
          rows: z
            .array(
              z.object({
                guestName: z.string().min(1),
                guestPhone: z.string().optional(),
                roomCategoryId: z.string(),
                checkIn: z.coerce.date(),
                checkOut: z.coerce.date(),
                nights: z.number().int().positive(),
                totalAmount: z.number().nonnegative(),
                otaBookingRef: z.string().optional(),
              }),
            )
            .min(1)
            .max(500),
        }),
      )
      .mutation(({ input }) => bookings.importHistoricalBookings(input)),

    /** Dev/demo stand-in for a real OTA webhook — see bookings.service.ts's simulateInboundBooking. */
    simulateInboundBooking: reservationsManager
      .input(
        z.object({
          hotelId: z.string(),
          otaConnectionId: z.string(),
          source: otaCodeSchema,
          guestName: z.string().min(1),
          roomCategoryId: z.string(),
          checkIn: z.coerce.date(),
          checkOut: z.coerce.date(),
          nights: z.number().int().positive(),
          totalAmount: z.number().nonnegative(),
        }),
      )
      .mutation(({ input }) => bookings.simulateInboundBooking(input)),

    cancelBooking: reservationsManager
      .input(z.object({ bookingId: z.string() }))
      .mutation(({ ctx, input }) => bookings.cancelBooking({ ...input, actorId: ctx.user.userId })),

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

    listDues: frontDeskUp.input(z.object({ hotelId: z.string() })).query(({ input }) => bookings.listDues(input.hotelId)),

    resolveDelay: ownerOrManager
      .input(z.object({ bookingId: z.string(), note: z.string().min(1) }))
      .mutation(({ ctx, input }) => bookings.resolveDelay({ ...input, resolvedBy: ctx.user.userId })),

    /** Correct a recent check-in mistake — only within the 1-hour window (enforced server-side, not just hidden in the UI). */
    updateBooking: frontDeskUp
      .input(
        z.object({
          bookingId: z.string(),
          guestId: z.string().optional(),
          title: z.string().optional(),
          guestName: z.string().min(1).optional(),
          guestPhone: z.string().regex(/^\d{10}$/).optional(),
          email: z.string().email().optional(),
          gender: genderSchema.optional(),
          dateOfBirth: z.coerce.date().optional(),
          address: z.string().optional(),
          country: z.string().optional(),
          state: z.string().optional(),
          city: z.string().optional(),
          pincode: z.string().optional(),
          idType: idTypeSchema.optional(),
          idNumber: z.string().min(1).optional(),
          purposeOfStay: z.string().optional(),
          roomId: z.string().optional(),
          checkIn: z.coerce.date().optional(),
          checkOut: z.coerce.date().optional(),
          nights: z.number().int().positive().max(365).optional(),
          totalAmount: z.number().nonnegative().optional(),
          lineItems: lineItemsAtCheckInSchema,
          discountAmount: z.number().nonnegative().nullable().optional(),
          gstExempt: z.boolean().optional(),
        }),
      )
      .mutation(({ ctx, input }) => bookings.updateBooking({ ...input, actorId: ctx.user.userId })),

    deletePayment: frontDeskUp
      .input(z.object({ paymentId: z.string() }))
      .mutation(({ ctx, input }) => bookings.deletePayment({ ...input, actorId: ctx.user.userId })),

    /** "Add another guest" — a co-occupant on the same booking, available for the whole stay (not time-limited like updateBooking). */
    addBookingGuest: frontDeskUp
      .input(
        z.object({
          bookingId: z.string(),
          title: z.string().optional(),
          name: z.string().min(1),
          phone: z.string().regex(/^\d{10}$/).optional(),
          idType: idTypeSchema.optional(),
          idNumber: z.string().optional(),
        }),
      )
      .mutation(({ ctx, input }) => bookings.addBookingGuest({ ...input, actorId: ctx.user.userId })),

    listBookingGuests: anyPmsRole.input(z.object({ bookingId: z.string() })).query(({ input }) => bookings.listBookingGuests(input.bookingId)),

    removeBookingGuest: frontDeskUp
      .input(z.object({ id: z.string() }))
      .mutation(({ ctx, input }) => bookings.removeBookingGuest({ ...input, actorId: ctx.user.userId })),
  });
}
