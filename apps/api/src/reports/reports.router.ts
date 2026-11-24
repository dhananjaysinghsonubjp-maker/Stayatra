import { z } from 'zod';
import { requireRole } from '../trpc/trpc.js';
import { router } from '../trpc/trpc.js';
import type { ReportsService } from './reports.service.js';

const ownerOrManager = requireRole('pms', ['owner', 'manager']);

export function createReportsRouter(reports: ReportsService) {
  return router({
    rooms: ownerOrManager
      .input(z.object({ hotelId: z.string(), from: z.coerce.date(), to: z.coerce.date() }))
      .query(({ input }) => reports.getRoomsReport(input)),

    sale: ownerOrManager
      .input(z.object({ hotelId: z.string(), month: z.string().regex(/^\d{4}-\d{2}$/) }))
      .query(({ input }) => reports.getSaleReport(input)),

    reservations: ownerOrManager
      .input(
        z.object({
          hotelId: z.string(),
          statuses: z.array(z.enum(['confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show', 'void'])).optional(),
          checkInFrom: z.coerce.date().optional(),
          checkInTo: z.coerce.date().optional(),
          checkOutFrom: z.coerce.date().optional(),
          checkOutTo: z.coerce.date().optional(),
          reservationFrom: z.coerce.date().optional(),
          reservationTo: z.coerce.date().optional(),
          search: z.string().optional(),
          source: z.string().optional(),
        }),
      )
      .query(({ input }) => reports.getReservationReport(input)),

    police: ownerOrManager
      .input(z.object({ hotelId: z.string(), from: z.coerce.date(), to: z.coerce.date() }))
      .query(({ input }) => reports.getPoliceReport(input)),

    dayWiseBookings: ownerOrManager
      .input(z.object({ hotelId: z.string(), from: z.coerce.date(), to: z.coerce.date() }))
      .query(({ input }) => reports.getDayWiseBookingReport(input)),

    checkInCheckOut: ownerOrManager
      .input(z.object({ hotelId: z.string(), from: z.coerce.date(), to: z.coerce.date() }))
      .query(({ input }) => reports.getCheckInCheckOutReport(input)),

    advanceReceived: ownerOrManager
      .input(z.object({ hotelId: z.string(), from: z.coerce.date(), to: z.coerce.date() }))
      .query(({ input }) => reports.getAdvanceReceivedReport(input)),

    roomSale: ownerOrManager
      .input(z.object({ hotelId: z.string(), from: z.coerce.date(), to: z.coerce.date() }))
      .query(({ input }) => reports.getRoomSaleReport(input)),

    gstBill: ownerOrManager
      .input(z.object({ hotelId: z.string(), from: z.coerce.date(), to: z.coerce.date() }))
      .query(({ input }) => reports.getGstBillReport(input)),

    paymentReceipts: ownerOrManager
      .input(z.object({ hotelId: z.string(), from: z.coerce.date(), to: z.coerce.date() }))
      .query(({ input }) => reports.getPaymentReceiptsReport(input)),

    profitAndLoss: ownerOrManager
      .input(z.object({ hotelId: z.string(), from: z.coerce.date(), to: z.coerce.date() }))
      .query(({ input }) => reports.getProfitAndLossReport(input)),

    creditAndDebit: ownerOrManager
      .input(z.object({ hotelId: z.string(), from: z.coerce.date(), to: z.coerce.date() }))
      .query(({ input }) => reports.getCreditAndDebitReport(input)),

    roomWiseRevenue: ownerOrManager
      .input(z.object({ hotelId: z.string(), from: z.coerce.date(), to: z.coerce.date() }))
      .query(({ input }) => reports.getRoomWiseRevenueReport(input)),

    invoiceBills: ownerOrManager
      .input(z.object({ hotelId: z.string(), from: z.coerce.date(), to: z.coerce.date() }))
      .query(({ input }) => reports.getInvoiceBillsReport(input)),

    paymentReport: ownerOrManager
      .input(z.object({ hotelId: z.string(), from: z.coerce.date(), to: z.coerce.date() }))
      .query(({ input }) => reports.getPaymentReport(input)),

    accountBook: ownerOrManager
      .input(z.object({ hotelId: z.string(), from: z.coerce.date(), to: z.coerce.date() }))
      .query(({ input }) => reports.getAccountBookReport(input)),

    advanceAdjustment: ownerOrManager
      .input(z.object({ hotelId: z.string(), from: z.coerce.date(), to: z.coerce.date() }))
      .query(({ input }) => reports.getAdvanceAdjustmentReport(input)),

    dayBook: ownerOrManager
      .input(z.object({ hotelId: z.string(), from: z.coerce.date(), to: z.coerce.date() }))
      .query(({ input }) => reports.getDayBookReport(input)),
  });
}
