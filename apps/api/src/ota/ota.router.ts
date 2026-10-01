import { z } from 'zod';
import { authedProcedure, router, requireRole } from '../trpc/trpc.js';
import type { OtaService } from './ota.service.js';
import type { OtaSyncService } from '../sync/ota-sync.service.js';

const ownerOrManager = requireRole('channel_manager', ['owner', 'manager']);
const otaCodeSchema = z.enum(['mmt_goibibo', 'booking_com', 'agoda', 'cleartrip', 'expedia', 'airbnb', 'easemytrip', 'yatra']);

export function createOtaRouter(ota: OtaService, sync: OtaSyncService) {
  return router({
    createConnection: ownerOrManager
      .input(z.object({ hotelId: z.string(), otaCode: otaCodeSchema }))
      .mutation(({ ctx, input }) => ota.createConnection({ ...input, actorId: ctx.user.userId })),

    listConnections: authedProcedure.input(z.object({ hotelId: z.string() })).query(({ input }) => ota.listConnections(input.hotelId)),

    mapRoomCategory: ownerOrManager
      .input(
        z.object({
          otaConnectionId: z.string(),
          roomCategoryId: z.string(),
          otaRoomName: z.string().min(1),
          otaRoomCode: z.string().optional(),
          otaRatePlanCode: z.string().optional(),
        }),
      )
      .mutation(({ ctx, input }) => ota.mapRoomCategory({ ...input, actorId: ctx.user.userId })),

    /** Feeds the mapping wizard's code-based picker (§3 step 6) — real per-OTA room/rate codes once that adapter can fetch them, empty for stub-only OTAs. */
    fetchRemoteProducts: ownerOrManager.input(z.object({ otaConnectionId: z.string() })).query(({ input }) => sync.fetchRemoteProducts(input.otaConnectionId)),

    /** "Test connection" (direct-ota-integration-guide.md §3 step 5). */
    testConnection: ownerOrManager.input(z.object({ otaConnectionId: z.string() })).mutation(({ input }) => sync.testConnection(input.otaConnectionId)),

    /** Manual "poll bookings now" — mirrors Full Sync's escape-hatch pattern. */
    pollBookings: ownerOrManager.input(z.object({ otaConnectionId: z.string() })).mutation(({ input }) => sync.pollBookingsNow(input.otaConnectionId)),

    listRoomMappings: authedProcedure.input(z.object({ otaConnectionId: z.string() })).query(({ input }) => ota.listRoomMappings(input.otaConnectionId)),

    removeRoomMapping: ownerOrManager
      .input(z.object({ otaConnectionId: z.string(), roomCategoryId: z.string() }))
      .mutation(({ input }) => ota.removeRoomMapping(input)),

    // §7 Phase 1 #13 — encrypted vault; only ever a boolean status leaves the server (ota.service.ts / credential-vault.service.ts).
    setCredentials: ownerOrManager
      .input(z.object({ otaConnectionId: z.string(), credentials: z.record(z.string(), z.string()) }))
      .mutation(({ ctx, input }) => ota.setCredentials({ ...input, actorId: ctx.user.userId })),

    getCredentialStatus: ownerOrManager
      .input(z.object({ otaConnectionId: z.string() }))
      .query(({ input }) => ota.getCredentialStatus(input.otaConnectionId)),

    setCommissionRate: ownerOrManager
      .input(z.object({ otaConnectionId: z.string(), commissionRatePercent: z.number().min(0).max(100).nullable() }))
      .mutation(({ input }) => ota.setCommissionRate(input)),

    // §7 Phase 1 #9 — manual re-push escape hatch.
    fullSync: ownerOrManager
      .input(z.object({ otaConnectionId: z.string() }))
      .mutation(({ input }) => sync.enqueueFullSync(input)),
  });
}
