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
  });
}
