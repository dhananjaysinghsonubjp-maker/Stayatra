import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { CleaningKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../common/audit.service.js';

const MIN_PHOTO_COUNT = 3;
const MIN_GUEST_CLEANING_NIGHTS = 2;

@Injectable()
export class CleaningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * §8.6. Interpreting the spec literally: "Checkout Cleaning closes the stay
   * and frees the room" — this submission IS what transitions the booking to
   * checked_out and the room to available, there's no separate front-desk
   * checkout step built yet. Flag if a distinct "guest physically left, awaiting
   * cleaning" front-desk action is actually wanted — that would insert a step
   * before this one instead of this one doing both.
   *
   * Idempotency: pass the same client-minted `id` on retry after a lost reply
   * (§8.6) — a second submit with the same id returns the existing record
   * instead of creating a duplicate / bogus discrepancy.
   */
  async submitCleaning(input: {
    id?: string;
    hotelId: string;
    roomId: string;
    kind: CleaningKind;
    primaryHousekeeperId: string;
    secondHousekeeperId?: string;
    photos: string[];
    actorId: string;
  }) {
    if (input.id) {
      const existing = await this.prisma.cleaningRecord.findUnique({ where: { id: input.id } });
      if (existing) return existing;
    }
    if (input.photos.length < MIN_PHOTO_COUNT) {
      throw new BadRequestException(`At least ${MIN_PHOTO_COUNT} photos are required`);
    }

    const room = await this.prisma.room.findUniqueOrThrow({ where: { id: input.roomId }, include: { currentStay: true } });
    const hasActiveStay = Boolean(room.currentStay);

    if (input.kind === CleaningKind.guest_stay && hasActiveStay && room.currentStay!.nights < MIN_GUEST_CLEANING_NIGHTS) {
      throw new ConflictException(`Guest Cleaning requires a stay of at least ${MIN_GUEST_CLEANING_NIGHTS} nights`);
    }

    const record = await this.prisma.$transaction(async (tx) => {
      const created = await tx.cleaningRecord.create({
        data: {
          id: input.id,
          hotelId: input.hotelId,
          roomId: input.roomId,
          stayId: room.currentStayId,
          kind: input.kind,
          primaryHousekeeperId: input.primaryHousekeeperId,
          secondHousekeeperId: input.secondHousekeeperId,
          photos: input.photos,
          flagged: !hasActiveStay, // no-guest discrepancy — the raw signal behind Theft Protection (§8.7)
        },
      });

      if (input.kind === CleaningKind.checkout && hasActiveStay) {
        await tx.booking.update({ where: { id: room.currentStayId! }, data: { status: 'checked_out' } });
        await tx.room.update({
          where: { id: input.roomId },
          data: { status: 'available', currentStayId: null, statusChangedAt: new Date() },
        });
      }

      return created;
    });

    await this.audit.log({
      hotelId: input.hotelId,
      eventType: record.flagged ? 'CLEANING_FLAGGED' : 'CLEANING_SUBMITTED',
      actorId: input.actorId,
      subjectId: record.id,
      detail: { roomId: input.roomId, kind: input.kind },
    });

    return record;
  }

  /** Owner-only; note hidden from housekeeping at the router layer (§8.1/§8.7). */
  async resolveDiscrepancy(input: { cleaningRecordId: string; resolvedBy: string; note: string }) {
    const record = await this.prisma.cleaningRecord.update({
      where: { id: input.cleaningRecordId },
      data: { resolvedAt: new Date(), resolvedBy: input.resolvedBy, resolvedNote: input.note },
    });
    await this.audit.log({
      hotelId: record.hotelId,
      eventType: 'DISCREPANCY_RESOLVED',
      actorId: input.resolvedBy,
      subjectId: record.id,
    });
    return record;
  }

  async listCleaningRecords(input: { hotelId: string; roomId?: string; flaggedOnly?: boolean }) {
    return this.prisma.cleaningRecord.findMany({
      where: { hotelId: input.hotelId, roomId: input.roomId, ...(input.flaggedOnly ? { flagged: true } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** "Housekeeping boys status" — who's cleaning, how many today/total, and their most recent room. */
  async getHousekeeperStats(hotelId: string) {
    const housekeepers = await this.prisma.user.findMany({
      where: { hotelId, moduleRoles: { some: { module: 'pms', role: 'housekeeping' } } },
      orderBy: { createdAt: 'asc' },
    });

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    return Promise.all(
      housekeepers.map(async (hk) => {
        const [cleaningsToday, cleaningsTotal, last] = await Promise.all([
          this.prisma.cleaningRecord.count({ where: { hotelId, primaryHousekeeperId: hk.id, createdAt: { gte: todayStart } } }),
          this.prisma.cleaningRecord.count({ where: { hotelId, primaryHousekeeperId: hk.id } }),
          this.prisma.cleaningRecord.findFirst({
            where: { hotelId, primaryHousekeeperId: hk.id },
            orderBy: { createdAt: 'desc' },
            include: { room: true },
          }),
        ]);
        return {
          id: hk.id,
          name: hk.name,
          cleaningsToday,
          cleaningsTotal,
          lastCleaningAt: last?.createdAt ?? null,
          lastRoomNumber: last?.room.roomNumber ?? null,
          lastFlagged: last?.flagged ?? false,
        };
      }),
    );
  }
}
