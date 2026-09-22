import { z } from 'zod';
import { authedProcedure, router, requireRole } from '../trpc/trpc.js';
import type { OtaService } from './ota.service.js';

const ownerOrManager = requireRole('channel_manager', ['owner', 'manager']);
const otaCodeSchema = z.enum(['mmt_goibibo', 'booking_com', 'agoda', 'cleartrip', 'expedia', 'airbnb']);

export function createOtaRouter(ota: OtaService) {
  return router({
    createConnection: ownerOrManager
      .input(z.object({ hotelId: z.string(), otaCode: otaCodeSchema }))
      .mutation(({ input }) => ota.createConnection(input)),

    listConnections: authedProcedure.input(z.object({ hotelId: z.string() })).query(({ input }) => ota.listConnections(input.hotelId)),

    mapRoomCategory: ownerOrManager
      .input(z.object({ otaConnectionId: z.string(), roomCategoryId: z.string(), otaRoomName: z.string().min(1) }))
      .mutation(({ input }) => ota.mapRoomCategory(input)),
  });
}
