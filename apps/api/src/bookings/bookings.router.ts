import { z } from 'zod';
import { authedProcedure, router, requireRole } from '../trpc/trpc.js';
import type { BookingsService } from './bookings.service.js';
import { isHousekeeping, redactForHousekeeping } from './redact.js';

const frontDeskUp = requireRole('pms', ['owner', 'manager', 'front_desk']);
const anyPmsRole = requireRole('pms', ['owner', 'manager', 'front_desk', 'housekeeping']);
const ownerOrManager = requireRole('pms', ['owner', 'manager']);

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

    listDues: frontDeskUp.input(z.object({ hotelId: z.string() })).query(({ input }) => bookings.listDues(input.hotelId)),

    resolveDelay: ownerOrManager
      .input(z.object({ bookingId: z.string(), note: z.string().min(1) }))
      .mutation(({ ctx, input }) => bookings.resolveDelay({ ...input, resolvedBy: ctx.user.userId })),
  });
}
