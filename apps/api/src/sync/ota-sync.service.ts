import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { BookingStatus, OtaCode } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../common/audit.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { CredentialVaultService } from '../ota/credential-vault.service.js';
import { JOB_QUEUE, type JobQueue } from './queue.interface.js';
import type { OtaAdapter, OtaValidationResult, OtaRemoteProduct } from './adapters/ota-adapter.interface.js';
import { StubOtaAdapter } from './adapters/stub-adapter.js';
import { AgodaAdapter } from './adapters/agoda-adapter.js';

const QUEUE_PUSH = 'ota_push';
const QUEUE_PUSH_FAILED = 'ota_push_failed'; // dead-letter — retries exhausted (§7 Phase 1 #10)
const QUEUE_FULL_SYNC = 'ota_full_sync';

interface PushJobData {
  otaConnectionId: string;
  ratePlanId: string;
  startDate: string;
  endDate: string;
}

interface FullSyncJobData {
  otaConnectionId: string;
}

@Injectable()
export class OtaSyncService implements OnModuleInit {
  private readonly logger = new Logger(OtaSyncService.name);
  private readonly adapters: Record<OtaCode, OtaAdapter>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly vault: CredentialVaultService,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
  ) {
    const logApiCall = (otaConnectionId: string) => (log: { endpoint: string; requestBody: string; responseBody: string; httpStatus: number; latencyMs: number; errorMessage?: string }) =>
      void this.prisma.otaApiLog
        .create({
          data: {
            otaConnectionId,
            direction: 'outbound',
            endpoint: log.endpoint,
            requestBody: log.requestBody,
            responseBody: log.responseBody,
            httpStatus: log.httpStatus || null,
            latencyMs: log.latencyMs,
            errorMessage: log.errorMessage,
          },
        })
        .catch((err) => this.logger.error(`Failed to write OtaApiLog: ${err}`));

    // Every OTA code maps to the stub until its adapter is real — direct-ota-integration-guide.md's
    // suggested order: Agoda first (best public docs), then MMT/Goibibo, EaseMyTrip, Yatra, Cleartrip, Expedia.
    // A real adapter only activates once its platform-level credential env var is set (business step,
    // not a code change) — this.adapterFor() re-checks per call so setting the env var and restarting is enough.
    this.adapters = {
      mmt_goibibo: new StubOtaAdapter(),
      booking_com: new StubOtaAdapter(),
      agoda: new StubOtaAdapter(),
      cleartrip: new StubOtaAdapter(),
      expedia: new StubOtaAdapter(),
      airbnb: new StubOtaAdapter(),
      easemytrip: new StubOtaAdapter(),
      yatra: new StubOtaAdapter(),
    };
    this.agodaLogHook = logApiCall;
  }

  private readonly agodaLogHook: (otaConnectionId: string) => (log: any) => void;

  /** Picks the real adapter when its business step (partner API key) is done, else the stub — checked per call so no restart-order dependency beyond the env var being set. */
  private adapterFor(otaCode: OtaCode, otaConnectionId: string): OtaAdapter {
    if (otaCode === 'agoda' && process.env.AGODA_API_KEY) {
      return new AgodaAdapter(process.env.AGODA_API_KEY, this.agodaLogHook(otaConnectionId));
    }
    return this.adapters[otaCode];
  }

  async onModuleInit() {
    await this.queue.createQueue(QUEUE_PUSH_FAILED); // must exist first — referenced as a deadLetter target below
    await this.queue.createQueue(QUEUE_PUSH, { retryLimit: 3, retryDelay: 30, deadLetter: QUEUE_PUSH_FAILED });
    await this.queue.createQueue(QUEUE_FULL_SYNC, { retryLimit: 3, retryDelay: 30, deadLetter: QUEUE_PUSH_FAILED });

    await this.queue.work<PushJobData>(QUEUE_PUSH, (data) => this.handlePush(data));
    await this.queue.work<FullSyncJobData>(QUEUE_FULL_SYNC, (data) => this.handleFullSync(data));
    await this.queue.work<PushJobData | FullSyncJobData>(QUEUE_PUSH_FAILED, (data) => this.handleExhaustedRetries(data));
  }

  /** Called after a Bulk Update / Value Override write succeeds (§7 Phase 1 #7/#8/#9). */
  async enqueueRatePush(input: { otaConnectionId: string; ratePlanId: string; startDate: Date; endDate: Date }) {
    await this.queue.enqueue(QUEUE_PUSH, {
      otaConnectionId: input.otaConnectionId,
      ratePlanId: input.ratePlanId,
      startDate: input.startDate.toISOString(),
      endDate: input.endDate.toISOString(),
    } satisfies PushJobData);
  }

  /** Full Sync manual escape hatch (§7 Phase 1 #9). */
  async enqueueFullSync(input: { otaConnectionId: string }) {
    await this.queue.enqueue(QUEUE_FULL_SYNC, { otaConnectionId: input.otaConnectionId } satisfies FullSyncJobData);
  }

  /** "Test connection" (direct-ota-integration-guide.md §3 step 5) — a synchronous ✅/❌, not a queued job. */
  async testConnection(otaConnectionId: string): Promise<OtaValidationResult> {
    const connection = await this.prisma.otaConnection.findUniqueOrThrow({ where: { id: otaConnectionId } });
    const adapter = this.adapterFor(connection.otaCode, connection.id);
    if (!adapter.validateCredentials) return { valid: false, message: 'This channel has no real connectivity yet — nothing to test against' };
    const credentials = await this.decryptCredentials(connection.id);
    if (!credentials) return { valid: false, message: 'No credentials saved for this channel yet' };
    return adapter.validateCredentials(credentials);
  }

  /** Feeds the mapping wizard's code-based picker (§3 step 6) once a real adapter can fetch the OTA's actual room/rate list. */
  async fetchRemoteProducts(otaConnectionId: string): Promise<OtaRemoteProduct[]> {
    const connection = await this.prisma.otaConnection.findUniqueOrThrow({ where: { id: otaConnectionId } });
    const adapter = this.adapterFor(connection.otaCode, connection.id);
    if (!adapter.fetchRemoteProducts) return [];
    const credentials = await this.decryptCredentials(connection.id);
    if (!credentials) return [];
    return adapter.fetchRemoteProducts(credentials);
  }

  /** Manual "Poll bookings now" (mirrors Full Sync's manual-escape-hatch pattern) — a real recurring poller is separate follow-up work. */
  async pollBookingsNow(otaConnectionId: string): Promise<{ imported: number; skipped: number }> {
    const connection = await this.prisma.otaConnection.findUniqueOrThrow({ where: { id: otaConnectionId } });
    const adapter = this.adapterFor(connection.otaCode, connection.id);
    if (!adapter.pollBookings) return { imported: 0, skipped: 0 };
    const credentials = await this.decryptCredentials(connection.id);
    if (!credentials) return { imported: 0, skipped: 0 };

    const payloads = await adapter.pollBookings(credentials);
    let imported = 0;
    let skipped = 0;
    for (const payload of payloads) {
      const mapping = await this.prisma.otaRoomMapping.findFirst({
        where: { otaConnectionId, otaRoomCode: payload.otaRoomCode },
      });
      if (!mapping) {
        skipped++;
        continue;
      }
      const existing = await this.prisma.booking.findFirst({
        where: { otaConnectionId, otaBookingRef: payload.otaBookingRef },
      });
      const targetStatus = payload.status === 'cancelled' ? BookingStatus.cancelled : BookingStatus.confirmed;
      if (existing) {
        if (existing.status !== targetStatus) {
          await this.prisma.booking.update({ where: { id: existing.id }, data: { status: targetStatus } });
          if (targetStatus === BookingStatus.cancelled) {
            await this.notifications.create({
              hotelId: connection.hotelId,
              type: 'booking_cancelled',
              title: `Booking cancelled — ${connection.otaCode}`,
              body: `${existing.guestName}, ${payload.checkIn} → ${payload.checkOut}`,
              link: 'bookings',
            });
          }
          imported++;
        } else {
          skipped++;
        }
        continue;
      }
      if (targetStatus === BookingStatus.cancelled) {
        skipped++; // a cancellation for a booking we never saw isn't worth creating just to mark it cancelled
        continue;
      }
      const nights = Math.max(1, Math.round((new Date(payload.checkOut).getTime() - new Date(payload.checkIn).getTime()) / 86400000));
      await this.prisma.booking.create({
        data: {
          hotelId: connection.hotelId,
          otaConnectionId,
          otaBookingRef: payload.otaBookingRef,
          guestName: payload.guestName,
          guestPhone: payload.guestPhone,
          roomCategoryId: mapping.roomCategoryId,
          checkIn: new Date(payload.checkIn),
          checkOut: new Date(payload.checkOut),
          nights,
          totalAmount: payload.totalAmount,
          source: connection.otaCode,
          status: BookingStatus.confirmed,
        },
      });
      await this.notifications.create({
        hotelId: connection.hotelId,
        type: 'booking_created',
        title: `New booking — ${connection.otaCode}`,
        body: `${payload.guestName}, ${payload.checkIn} → ${payload.checkOut}`,
        link: 'bookings',
      });
      imported++;
    }
    return { imported, skipped };
  }

  private async decryptCredentials(otaConnectionId: string): Promise<Record<string, string> | null> {
    try {
      return await this.vault.decrypt(otaConnectionId);
    } catch {
      return null;
    }
  }

  private async handlePush(data: PushJobData) {
    const connection = await this.prisma.otaConnection.findUniqueOrThrow({ where: { id: data.otaConnectionId } });
    const ratePlan = await this.prisma.ratePlan.findUniqueOrThrow({ where: { id: data.ratePlanId } });
    const mapping = await this.prisma.otaRoomMapping.findUnique({
      where: { otaConnectionId_roomCategoryId: { otaConnectionId: data.otaConnectionId, roomCategoryId: ratePlan.roomCategoryId } },
    });

    // Re-query current state at process time rather than trusting data captured
    // at enqueue time — avoids pushing stale prices if several bulk updates
    // landed on the same cells before this job ran.
    const cells = await this.prisma.inventoryRate.findMany({
      where: {
        ratePlanId: data.ratePlanId,
        otaConnectionId: data.otaConnectionId,
        date: { gte: new Date(data.startDate), lte: new Date(data.endDate) },
      },
    });

    const adapter = this.adapterFor(connection.otaCode, connection.id);
    const credentials = await this.decryptCredentials(connection.id);
    const result = await adapter.pushRates({
      credentials,
      otaRoomCode: mapping?.otaRoomCode ?? null,
      otaRatePlanCode: mapping?.otaRatePlanCode ?? null,
      otaRoomName: mapping?.otaRoomName ?? null,
      cells: cells.map((c) => ({
        date: c.date.toISOString().slice(0, 10),
        occupancyTier: c.occupancyTier,
        price: Number(c.price),
        availability: c.availability,
      })),
    });

    if (!result.success) throw new Error(result.message ?? 'OTA push failed');

    await this.prisma.otaConnection.update({ where: { id: connection.id }, data: { status: 'connected' } });
  }

  private async handleFullSync(data: FullSyncJobData) {
    const connection = await this.prisma.otaConnection.findUniqueOrThrow({ where: { id: data.otaConnectionId } });
    const adapter = this.adapterFor(connection.otaCode, connection.id);
    const credentials = await this.decryptCredentials(connection.id);
    const result = await adapter.fullSync({ credentials, hotelId: connection.hotelId });
    if (!result.success) throw new Error(result.message ?? 'Full sync failed');
    await this.prisma.otaConnection.update({ where: { id: connection.id }, data: { status: 'connected' } });
  }

  /**
   * Dead-letter handler — a push exhausted its retries. §7 Phase 1 #10 calls
   * for a push notification here; Expo push isn't wired yet (no mobile client
   * exists), so this is the interim alert: connection flips to 'error' (every
   * client already polls/shows ota_connections.status), it's logged to
   * audit_log, and an in-app Notification fires (the web equivalent until
   * mobile push exists — swap in a real send once mobile exists).
   */
  private async handleExhaustedRetries(data: PushJobData | FullSyncJobData) {
    const connection = await this.prisma.otaConnection.findUniqueOrThrow({ where: { id: data.otaConnectionId } });
    await this.prisma.otaConnection.update({ where: { id: connection.id }, data: { status: 'error' } });
    this.logger.error(`OTA sync exhausted retries for connection ${connection.id} (${connection.otaCode})`);
    await this.audit.log({
      hotelId: connection.hotelId,
      eventType: 'SYNC_FAILED',
      actorId: 'system:ota-sync',
      subjectId: connection.id,
      detail: { reason: 'sync_retries_exhausted', otaCode: connection.otaCode },
    });
    await this.notifications.create({
      hotelId: connection.hotelId,
      type: 'sync_failed',
      title: `Sync failed — ${connection.otaCode}`,
      body: 'Rate/availability push exhausted its retries. Use Full Sync to retry once the issue is fixed.',
      link: 'cm_channels',
    });
  }
}
