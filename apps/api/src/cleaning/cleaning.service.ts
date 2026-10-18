import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { CleaningKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../common/audit.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';

const MIN_PHOTO_COUNT = 3;
const MIN_GUEST_CLEANING_NIGHTS = 2;

@Injectable()
export class CleaningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * §user request — housekeeping keeps its full existing flexibility: it can clean ANY room,
   * with or without a prior FMO check-in/check-out on record (§Scenario 2/3). A Checkout
   * Cleaning ALWAYS completes and frees the room to 'available' once submitted — availability
   * depends only on the cleaning workflow finishing, never on whether the FMO acted first.
   *
   * `hasActiveStay` (any stay linked to this room's current cycle, regardless of whether that
   * stay is still 'checked_in' or already 'checked_out' by the FMO's own Check-out Guest step)
   * is the one signal that drives both: (a) whether this closes out a dangling booking too, and
   * (b) the `flagged` discrepancy — a cleaning is only flagged "NO GUEST CHECK-IN FOUND" when it
   * can't be matched to ANY guest stay at all. A legitimate post-FMO-checkout cleaning is never
   * flagged (the FMO's checkout deliberately leaves currentStayId set through the pending-cleanup
   * window, specifically so this check still sees it as a match, per §Scenario 1's "a previous
   * guest checked out correctly... must not generate a discrepancy").
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

    const flagged = !hasActiveStay;

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
          flagged, // no matching guest stay — the raw signal behind Theft Protection (§8.7)
        },
      });

      if (input.kind === CleaningKind.checkout && hasActiveStay) {
        await tx.booking.update({
          where: { id: room.currentStayId! },
          data: {
            status: 'checked_out',
            // Only back-fill if the FMO didn't already record this — never overwrite a real
            // Check-out Guest timestamp/actor with a housekeeping-triggered forced close.
            ...(room.currentStay!.checkedOutAt ? {} : { checkedOutAt: new Date() }),
          },
        });
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

    // §user request Scenario 2/5 — "NO GUEST CHECK-IN FOUND" must be raised on the Owner
    // Dashboard when a cleaning can't be matched to any guest stay. This is the one and only
    // notification this method fires — a plain FMO check-out (or a legitimate post-checkout
    // cleaning) must NEVER create a notification or discrepancy (§Scenario 5, rule 1 & 4).
    if (record.flagged) {
      await this.notifications.create({
        hotelId: input.hotelId,
        type: 'cleaning_discrepancy',
        title: `Room ${room.roomNumber} cleaned with no matching guest check-in`,
        body: 'No guest stay record matches this cleaning. Review it in Housekeeping.',
        link: 'housekeeping',
      });
    }

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

  /** Used both for the "pick a second housekeeper" step (§8.6, matching the Skymax reference
   * app's two-person rule) and the plain roster on the Housekeeping page (§user request — "bas
   * ye show hoga ki konse boys housekeeping me hai and kaun si shift me kaam kar rahe hai"). */
  async listHousekeepers(hotelId: string) {
    return this.prisma.user.findMany({
      where: { hotelId, active: true, moduleRoles: { some: { module: 'pms', role: 'housekeeping' } } },
      select: { id: true, name: true, shift: true },
      orderBy: { name: 'asc' },
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
