import { Module } from '@nestjs/common';
import { PgBossQueueService } from './pg-boss-queue.service.js';
import { OtaSyncService } from './ota-sync.service.js';
import { JOB_QUEUE } from './queue.interface.js';

@Module({
  providers: [{ provide: JOB_QUEUE, useClass: PgBossQueueService }, OtaSyncService],
  exports: [OtaSyncService],
})
export class SyncModule {}
