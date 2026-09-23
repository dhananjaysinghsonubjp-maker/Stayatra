import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PgBoss, type Job } from 'pg-boss';
import type { JobQueue } from './queue.interface.js';

// §3: "pg-boss (Postgres-native) initially, behind a swappable interface;
// migrate to BullMQ + Redis when the ceiling in §2 is hit." This is the only
// file that imports pg-boss directly — swapping backends later means writing
// one new class against JobQueue, not touching call sites.
@Injectable()
export class PgBossQueueService implements JobQueue, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PgBossQueueService.name);
  private boss: PgBoss;

  constructor() {
    this.boss = new PgBoss(process.env.DATABASE_URL!);
    this.boss.on('error', (err: Error) => this.logger.error('pg-boss error', err));
  }

  async onModuleInit() {
    await this.start();
  }

  async onModuleDestroy() {
    await this.stop();
  }

  async start() {
    await this.boss.start();
  }

  async stop() {
    await this.boss.stop({ graceful: true, timeout: 5000 });
  }

  async createQueue(name: string, options?: { retryLimit?: number; retryDelay?: number; deadLetter?: string }) {
    await this.boss.createQueue(name, options);
  }

  async enqueue(queueName: string, data: object) {
    return this.boss.send(queueName, data);
  }

  async work<T extends object>(queueName: string, handler: (data: T) => Promise<void>) {
    await this.boss.work<T>(queueName, async (jobs: Job<T>[]) => {
      for (const job of jobs) {
        await handler(job.data);
      }
    });
  }
}
