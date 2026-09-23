import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OtaCode } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../common/audit.service.js';
import { JOB_QUEUE, type JobQueue } from './queue.interface.js';
import type { OtaAdapter } from './adapters/ota-adapter.interface.js';
import { StubOtaAdapter } from './adapters/stub-adapter.js';

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

  // Every OTA code maps to the stub today — swap individual entries for real
  // adapters as partner API access lands, starting with mmt_goibibo.
  private readonly adapters: Record<OtaCode, OtaAdapter> = {
    mmt_goibibo: new StubOtaAdapter(),
    booking_com: new StubOtaAdapter(),
    agoda: new StubOtaAdapter(),
    cleartrip: new StubOtaAdapter(),
    expedia: new StubOtaAdapter(),
    airbnb: new StubOtaAdapter(),
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
  ) {}

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

    const adapter = this.adapters[connection.otaCode];
    const result = await adapter.pushRates({
      credentialRef: connection.credentialRef,
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
    const adapter = this.adapters[connection.otaCode];
    const result = await adapter.fullSync({ credentialRef: connection.credentialRef, hotelId: connection.hotelId });
    if (!result.success) throw new Error(result.message ?? 'Full sync failed');
    await this.prisma.otaConnection.update({ where: { id: connection.id }, data: { status: 'connected' } });
  }

  /**
   * Dead-letter handler — a push exhausted its retries. §7 Phase 1 #10 calls
   * for a push notification here; Expo push isn't wired yet (no mobile client
   * exists), so this is the interim alert: connection flips to 'error' (every
   * client already polls/shows ota_connections.status) and it's logged to
   * audit_log. Swap in a real push send once mobile exists.
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
  }
}
