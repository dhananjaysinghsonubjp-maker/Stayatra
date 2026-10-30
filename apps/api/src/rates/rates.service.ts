import { Injectable, ConflictException } from '@nestjs/common';
import { Prisma, RateSource, type InventoryRate, type AuditEventType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { computeGstSlab } from '../common/gst.js';
import { AuditService } from '../common/audit.service.js';

/**
 * §bugfix — a real stay's actual arrival/departure TIME (2pm check-in, 11am check-out next day —
 * the exact Stay Details default this session) must never change how many nights this counts,
 * only which calendar dates are covered does. The old version compared full timestamps
 * (`cursor <= end`), so adjustAvailabilityForStay's own "checkout minus 24h" for a 1-night stay
 * landed on *the same calendar day as check-in but an earlier time of day* (checkIn 14:00 vs.
 * that 11:00) — `cursor <= end` was false on the very first iteration, so the loop produced ZERO
 * dates and the OTA pool silently never decremented for any normal (non-midnight) walk-in at all.
 * Both ends are truncated to their UTC calendar date before comparing, which also makes the
 * "-24h" trick upstream in adjustAvailabilityForStay correct regardless of time-of-day (24h
 * always lands on the previous calendar day, no matter what time it started at).
 */
function datesInRange(start: Date, end: Date, daysOfWeek?: number[]): Date[] {
  const dates: Date[] = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const endDate = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  while (cursor <= endDate) {
    if (!daysOfWeek || daysOfWeek.includes(cursor.getUTCDay())) dates.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

// price/availability are optional here specifically for bulkUpdate's split
// Rate-Update-vs-Inventory-Update UX — setValueOverride's own form always
// sends both, so this relaxation doesn't change its behavior.
export interface TierSet {
  occupancyTier: number;
  price?: number;
  extraAdultPrice?: number;
  child1Price?: number;
  child2Price?: number;
  availability?: number;
}

@Injectable()
export class RatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Every CM audit event here keys off an otaConnectionId, not a hotelId directly — one lookup to resolve it, non-blocking to the caller's own result. */
  private async logCmEvent(otaConnectionId: string, eventType: AuditEventType, actorId: string, detail?: Prisma.InputJsonObject) {
    const connection = await this.prisma.otaConnection.findUnique({ where: { id: otaConnectionId }, select: { hotelId: true } });
    if (!connection) return;
    await this.audit.log({ hotelId: connection.hotelId, eventType, actorId, detail });
  }

  async createRatePlan(input: {
    roomCategoryId: string;
    name: string;
    mealPlan?: string;
    isDerived?: boolean;
    baseRatePlanId?: string;
    formula?: string;
  }) {
    return this.prisma.ratePlan.create({ data: input });
  }

  /** §user request — rate plans could only ever be created, never renamed/re-configured afterward. */
  async updateRatePlan(input: {
    ratePlanId: string;
    name?: string;
    mealPlan?: string | null;
    isDerived?: boolean;
    baseRatePlanId?: string | null;
    formula?: string | null;
  }) {
    const { ratePlanId, ...data } = input;
    return this.prisma.ratePlan.update({ where: { id: ratePlanId }, data });
  }

  /**
   * Safe to call on a plan nothing real depends on yet (e.g. the "Standard Rate" every room
   * category auto-gets on creation, before a real plan replaces it) — InventoryRate/Restriction
   * rows cascade-delete with it, but a real Booking referencing this plan blocks the delete
   * outright (no onDelete on that FK), surfaced here as a clear message instead of a raw 500.
   */
  async deleteRatePlan(ratePlanId: string) {
    try {
      await this.prisma.ratePlan.delete({ where: { id: ratePlanId } });
      return { ok: true };
    } catch (err: unknown) {
      const isFkViolation = typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2003';
      if (isFkViolation) {
        throw new ConflictException("This rate plan has real bookings against it and can't be deleted — rename it instead, or move those bookings to another plan first.");
      }
      throw err;
    }
  }

  async listRatePlans(roomCategoryId: string) {
    return this.prisma.ratePlan.findMany({ where: { roomCategoryId } });
  }

  /** Every rate plan across every room category, for the hotel-wide Rate Update / Inventory Update forms (one row per rate plan, not filtered to a single category first). */
  async listAllRatePlansForHotel(hotelId: string) {
    const plans = await this.prisma.ratePlan.findMany({
      where: { roomCategory: { hotelId } },
      include: { roomCategory: true },
      orderBy: [{ roomCategory: { name: 'asc' } }, { name: 'asc' }],
    });
    return plans.map(({ roomCategory, ...p }) => ({ ...p, roomCategoryName: roomCategory.name }));
  }

  /** The core grid read — every screen's data source (§5.1). Attaches GST slab info per cell. */
  async getGrid(input: { ratePlanId: string; otaConnectionId: string; startDate: Date; endDate: Date }) {
    const [rates, restrictions] = await Promise.all([
      this.prisma.inventoryRate.findMany({
        where: {
          ratePlanId: input.ratePlanId,
          otaConnectionId: input.otaConnectionId,
          date: { gte: input.startDate, lte: input.endDate },
        },
        orderBy: [{ date: 'asc' }, { occupancyTier: 'asc' }],
      }),
      this.prisma.restriction.findMany({
        where: {
          ratePlanId: input.ratePlanId,
          otaConnectionId: input.otaConnectionId,
          date: { gte: input.startDate, lte: input.endDate },
        },
        orderBy: { date: 'asc' },
      }),
    ]);

    return {
      rates: rates.map((r) => ({ ...r, gst: computeGstSlab(Number(r.price)) })),
      restrictions,
    };
  }

  /**
   * Pooled inventory (direct-ota-integration-guide.md's non-negotiable): every
   * physical room in a category is one shared pool, so a booking from ANY
   * source — any OTA, direct, or walk-in — must block that room-night on
   * every channel at once, or two OTAs could sell the same room twice.
   * Applies to every rate plan under the category (they all price the same
   * rooms) and every OTA connection the hotel has, clamped at 0. Pass a
   * negative delta when a stay is booked, positive when it's cancelled.
   * Silently a no-op until both a rate plan and a channel connection exist
   * for the cell in question — nothing to block there yet either way.
   */
  async adjustAvailabilityForStay(input: { hotelId: string; roomCategoryId: string; checkIn: Date; checkOut: Date; delta: number }) {
    const [ratePlans, connections] = await Promise.all([
      this.prisma.ratePlan.findMany({ where: { roomCategoryId: input.roomCategoryId }, select: { id: true } }),
      this.prisma.otaConnection.findMany({ where: { hotelId: input.hotelId }, select: { id: true } }),
    ]);
    if (ratePlans.length === 0 || connections.length === 0) return;

    const nights = datesInRange(input.checkIn, new Date(input.checkOut.getTime() - 86400000));
    if (nights.length === 0) return;

    // Each date param needs an explicit ::date cast — Prisma otherwise binds a JS Date as
    // `timestamp`, which silently matches nothing against this column's `date` type.
    // Every occupancy tier for the same room-night shares one physical-room pool (InventoryUpdate's
    // own rule: "a room is either free or not, regardless of how many guests occupy it") — this used
    // to filter to `occupancy_tier = 1` only, which left tier 2+ rows stale after every real booking,
    // cancellation, or walk-in block, and that staleness then got pushed straight to the OTA (ota-sync
    // pushes every tier's cell). Updating every tier here keeps them all in lockstep with reality.
    await this.prisma.$executeRaw(Prisma.sql`
      UPDATE inventory_rates
      SET availability = GREATEST(availability + ${input.delta}, 0)
      WHERE rate_plan_id IN (${Prisma.join(ratePlans.map((r) => r.id))})
        AND ota_connection_id IN (${Prisma.join(connections.map((c) => c.id))})
        AND date IN (${Prisma.join(nights.map((n) => Prisma.sql`${n}::date`))})
    `);
  }

  /**
   * Walk-in inventory holdback (§ user request) — no booking record, no guest details,
   * just pulls N rooms out of the same pooled-availability count real bookings use, so a
   * walk-in physically occupying a room can't also be sold to another OTA. Capacity-checked
   * the same simple overlap-count way createManualBooking checks itself against double-booking.
   */
  async createRoomBlock(input: {
    hotelId: string;
    roomCategoryId: string;
    startDate: Date;
    endDate: Date;
    roomsBlocked: number;
    reason?: string;
    actorId: string;
  }) {
    if (input.roomsBlocked < 1) throw new ConflictException('Rooms blocked must be at least 1');

    const [totalRooms, overlappingBookings, overlappingBlocks] = await Promise.all([
      this.prisma.room.count({ where: { hotelId: input.hotelId, roomCategoryId: input.roomCategoryId, active: true } }),
      this.prisma.booking.count({
        where: {
          hotelId: input.hotelId,
          roomCategoryId: input.roomCategoryId,
          status: { in: ['confirmed', 'checked_in'] },
          checkIn: { lt: input.endDate },
          checkOut: { gt: input.startDate },
        },
      }),
      this.prisma.roomBlock.aggregate({
        _sum: { roomsBlocked: true },
        where: {
          hotelId: input.hotelId,
          roomCategoryId: input.roomCategoryId,
          releasedAt: null,
          startDate: { lt: input.endDate },
          endDate: { gt: input.startDate },
        },
      }),
    ]);
    const alreadyBlocked = overlappingBlocks._sum.roomsBlocked ?? 0;
    const available = totalRooms - overlappingBookings - alreadyBlocked;
    if (input.roomsBlocked > available) {
      throw new ConflictException(`Only ${Math.max(available, 0)} room(s) available in this category for the selected dates`);
    }

    const block = await this.prisma.roomBlock.create({
      data: {
        hotelId: input.hotelId,
        roomCategoryId: input.roomCategoryId,
        startDate: input.startDate,
        endDate: input.endDate,
        roomsBlocked: input.roomsBlocked,
        reason: input.reason,
        createdBy: input.actorId,
      },
    });
    await this.adjustAvailabilityForStay({
      hotelId: input.hotelId,
      roomCategoryId: input.roomCategoryId,
      checkIn: input.startDate,
      checkOut: input.endDate,
      delta: -input.roomsBlocked,
    });
    return block;
  }

  async releaseRoomBlock(input: { roomBlockId: string; actorId: string }) {
    const block = await this.prisma.roomBlock.findUniqueOrThrow({ where: { id: input.roomBlockId } });
    if (block.releasedAt) return block; // already released — no-op, not an error

    const released = await this.prisma.roomBlock.update({
      where: { id: input.roomBlockId },
      data: { releasedAt: new Date(), releasedBy: input.actorId },
    });
    await this.adjustAvailabilityForStay({
      hotelId: block.hotelId,
      roomCategoryId: block.roomCategoryId,
      checkIn: block.startDate,
      checkOut: block.endDate,
      delta: block.roomsBlocked,
    });
    return released;
  }

  /** For the router's post-write OTA-push fan-out (same connections `adjustAvailabilityForStay` already pools across). */
  async listOtaConnectionIds(hotelId: string) {
    return this.prisma.otaConnection.findMany({ where: { hotelId }, select: { id: true } });
  }

  /** Active (not yet released) blocks only — a hotel-wide list for the "release this" UI. */
  async listRoomBlocks(hotelId: string) {
    return this.prisma.roomBlock.findMany({
      where: { hotelId, releasedAt: null },
      include: { roomCategory: { select: { name: true } } },
      orderBy: { startDate: 'asc' },
    });
  }

  /** The Calendar cell editor's own private staff note — scoped to category+date, not any one channel. */
  async getDayNote(roomCategoryId: string, date: Date) {
    return this.prisma.dayNote.findUnique({ where: { roomCategoryId_date: { roomCategoryId, date } } });
  }

  /**
   * Every connection's individual stop-sell state for one room-night (§ user request) —
   * the Calendar cell editor's "Will push to" list used to show every connected channel
   * with no indication that one of them might already be individually blocked via Advance
   * Bulk Update, so hitting "Save & push" with the Open/Blocked toggle left wherever it
   * happened to land silently overwrote that channel's deliberate, separate block state too.
   */
  async getChannelBlockStatus(ratePlanId: string, date: Date) {
    const rows = await this.prisma.restriction.findMany({
      where: { ratePlanId, date },
      select: { otaConnectionId: true, channelBlocked: true },
    });
    return Object.fromEntries(rows.map((r) => [r.otaConnectionId, r.channelBlocked]));
  }

  async upsertDayNote(input: { hotelId: string; roomCategoryId: string; date: Date; note: string; actorId: string }) {
    if (!input.note.trim()) {
      await this.prisma.dayNote.deleteMany({ where: { roomCategoryId: input.roomCategoryId, date: input.date } });
      return null;
    }
    return this.prisma.dayNote.upsert({
      where: { roomCategoryId_date: { roomCategoryId: input.roomCategoryId, date: input.date } },
      create: { hotelId: input.hotelId, roomCategoryId: input.roomCategoryId, date: input.date, note: input.note, updatedBy: input.actorId },
      update: { note: input.note, updatedBy: input.actorId },
    });
  }

  /**
   * The Calendar's drag-to-select Bulk Edit panel — same single-room-night write as
   * `saveCellEditor`, just fanned out across a date range (optionally filtered to
   * weekdays/weekends), every selected room category's primary rate plan, and every
   * connected channel. `overrideValueOverrides: true` because the dates here were
   * deliberately drag-selected by hand, not swept up by an unrelated date-range edit —
   * silently skipping some would be more surprising than honoring the visible selection.
   *
   * §bugfix — same redundant-write fix as saveCellEditor: bulkUpdate's own availability fan-out
   * (triggered once per connection here) used to mean every cell in the range got written once
   * per connection *for every connection*, not once total. Only the first connection's call
   * carries availability now — its fan-out handles the rest — later connections just get price.
   */
  async bulkEditCells(input: {
    hotelId: string;
    roomCategoryIds: string[];
    startDate: Date;
    endDate: Date;
    daysOfWeek?: number[];
    price: number;
    availability: number;
    actorId: string;
  }) {
    const [connections, ratePlans] = await Promise.all([
      this.prisma.otaConnection.findMany({ where: { hotelId: input.hotelId }, select: { id: true } }),
      this.prisma.ratePlan.findMany({ where: { roomCategoryId: { in: input.roomCategoryIds } }, select: { id: true, roomCategoryId: true } }),
    ]);
    // One primary rate plan per selected category — mirrors Calendar's own primaryPlanByCategory (every room in a category shares one price).
    const primaryByCategory = new Map<string, string>();
    for (const rp of ratePlans) if (!primaryByCategory.has(rp.roomCategoryId)) primaryByCategory.set(rp.roomCategoryId, rp.id);
    const ratePlanIds = [...primaryByCategory.values()];
    const [firstConn, ...restConns] = connections;

    for (const ratePlanId of ratePlanIds) {
      if (!firstConn) continue;
      await this.bulkUpdate({
        ratePlanId,
        otaConnectionId: firstConn.id,
        startDate: input.startDate,
        endDate: input.endDate,
        daysOfWeek: input.daysOfWeek,
        explicitTiers: [{ occupancyTier: 1, price: input.price, availability: input.availability }],
        overrideValueOverrides: true,
        changedBy: input.actorId,
      });
      for (const conn of restConns) {
        await this.bulkUpdate({
          ratePlanId,
          otaConnectionId: conn.id,
          startDate: input.startDate,
          endDate: input.endDate,
          daysOfWeek: input.daysOfWeek,
          explicitTiers: [{ occupancyTier: 1, price: input.price }],
          overrideValueOverrides: true,
          changedBy: input.actorId,
        });
      }
    }
    return { connectionIds: connections.map((c) => c.id), ratePlanIds };
  }

  /**
   * The Calendar cell editor's single "Save & push" action — pooled inventory (same
   * non-negotiable as `adjustAvailabilityForStay`) means one edit to a room-night applies
   * to every connected channel at once, not just whichever channel happened to be selected
   * in the grid's filter dropdown.
   *
   * §bugfix — "cell ke andar click karke jo changes karte hain, usko bhi fix karo": this used
   * to call setValueOverride once per connection to get that pooling — now that
   * setValueOverride fans availability out to every *other* connection on its own (see its own
   * comment), doing that in a loop here wrote every cell 3x for 3 channels (once directly, twice
   * more from the other two calls' own fan-out). One call now carries price+availability for the
   * first connection — its fan-out covers availability everywhere — and the rest only need price
   * explicitly pushed (this editor has no per-channel price of its own, same "one value, every
   * channel" design the UI already had). Restriction (channelBlocked) was never fanned and still
   * isn't — it's genuinely per-channel — so that loop is unchanged.
   */
  async saveCellEditor(input: {
    hotelId: string;
    roomCategoryId: string;
    ratePlanId: string;
    date: Date;
    price: number;
    availability: number;
    blocked: boolean;
    dayNote: string;
    actorId: string;
  }) {
    const connections = await this.prisma.otaConnection.findMany({ where: { hotelId: input.hotelId }, select: { id: true } });
    const [first, ...rest] = connections;
    if (first) {
      await this.setValueOverride({
        ratePlanId: input.ratePlanId,
        otaConnectionId: first.id,
        date: input.date,
        tiers: [{ occupancyTier: 1, price: input.price, availability: input.availability }],
        changedBy: input.actorId,
      });
      for (const conn of rest) {
        const existing = await this.prisma.inventoryRate.findUnique({
          where: {
            ratePlanId_otaConnectionId_date_occupancyTier: { ratePlanId: input.ratePlanId, otaConnectionId: conn.id, date: input.date, occupancyTier: 1 },
          },
        });
        await this.upsertBulkCell(input.ratePlanId, conn.id, input.date, { occupancyTier: 1, price: input.price }, input.actorId, existing ?? undefined);
      }
    }
    for (const conn of connections) {
      await this.upsertRestriction({
        ratePlanId: input.ratePlanId,
        otaConnectionId: conn.id,
        date: input.date,
        channelBlocked: input.blocked,
        actorId: input.actorId,
      });
    }
    await this.upsertDayNote({
      hotelId: input.hotelId,
      roomCategoryId: input.roomCategoryId,
      date: input.date,
      note: input.dayNote,
      actorId: input.actorId,
    });
    return { connectionIds: connections.map((c) => c.id) };
  }

  /**
   * §7 Phase 1 #3: a genuinely separate write path from Bulk Update. Always
   * wins over a bulk write to the same cell until explicitly overridden (§5.5).
   */
  /**
   * Every OTA connection sharing this rate plan's hotel, except the one already being written to
   * directly. §user request — "4 room mein se 2 hi dikhne chahiye, chahe kisi bhi channel se dekho":
   * availability must never be allowed to drift between channels (direct-ota-integration-guide.md's
   * "pooled inventory... non-negotiable"), so every caller that touches availability fans it out
   * here instead of trusting whichever single channel a form happened to have selected.
   */
  private async otherConnectionIds(ratePlanId: string, excludeConnectionId: string): Promise<string[]> {
    const ratePlan = await this.prisma.ratePlan.findUniqueOrThrow({
      where: { id: ratePlanId },
      select: { roomCategory: { select: { hotelId: true } } },
    });
    const connections = await this.prisma.otaConnection.findMany({
      where: { hotelId: ratePlan.roomCategory.hotelId, id: { not: excludeConnectionId } },
      select: { id: true },
    });
    return connections.map((c) => c.id);
  }

  // §bugfix — "sirf ek channel pe hi push ho raha hai, baaki OTA pe update hi nahi ja raha":
  // setValueOverride's fan-out (above) correctly updates every sibling connection's row in our
  // own database, but the router only ever enqueued a real push to the one otaConnectionId it was
  // called with — every *other* channel's actual listing on the real OTA extranet silently never
  // got the new price/availability at all. Used by the router to push to every connection once a
  // pool-wide write (the common case: Calendar's editor, bulk tools) has actually touched them.
  async allConnectionIds(ratePlanId: string): Promise<string[]> {
    const ratePlan = await this.prisma.ratePlan.findUniqueOrThrow({
      where: { id: ratePlanId },
      select: { roomCategory: { select: { hotelId: true } } },
    });
    const connections = await this.prisma.otaConnection.findMany({
      where: { hotelId: ratePlan.roomCategory.hotelId },
      select: { id: true },
    });
    return connections.map((c) => c.id);
  }

  async setValueOverride(input: {
    ratePlanId: string;
    otaConnectionId: string;
    date: Date;
    tiers: TierSet[];
    changedBy: string;
    // §user request — "booking.com ko block karna hai, baaki channels pe sell hota rahe": the
    // fan-out below is only correct when this write represents the real physical pool (the
    // Calendar editor and bulk tools, where one typed-in number is meant for every channel).
    // Advance Update's whole point is a DIFFERENT, single-channel-only override — stopping sale
    // on just this one connection without touching what every other channel still has to sell —
    // so it opts out here. Defaults to true so every existing pool-wide caller is unaffected.
    fanOutAvailability?: boolean;
  }) {
    const result = await this.prisma.$transaction(
      input.tiers.map((tier) =>
        this.prisma.inventoryRate.upsert({
          where: {
            ratePlanId_otaConnectionId_date_occupancyTier: {
              ratePlanId: input.ratePlanId,
              otaConnectionId: input.otaConnectionId,
              date: input.date,
              occupancyTier: tier.occupancyTier,
            },
          },
          create: {
            ratePlanId: input.ratePlanId,
            otaConnectionId: input.otaConnectionId,
            date: input.date,
            occupancyTier: tier.occupancyTier,
            price: tier.price ?? 0,
            extraAdultPrice: tier.extraAdultPrice,
            child1Price: tier.child1Price,
            child2Price: tier.child2Price,
            availability: tier.availability ?? 0,
            source: RateSource.value_override,
            changedBy: input.changedBy,
          },
          update: {
            price: tier.price ?? 0,
            extraAdultPrice: tier.extraAdultPrice,
            child1Price: tier.child1Price,
            child2Price: tier.child2Price,
            availability: tier.availability ?? 0,
            source: RateSource.value_override,
            changedBy: input.changedBy,
            changedAt: new Date(),
          },
        }),
      ),
    );

    // Price stays per-channel on purpose (a channel's own commission/markup is a real reason to
    // differ) — only availability (a true physical-room count) fans out, and it overrides whatever
    // source a sibling channel's cell already had: a conflicting per-channel override is exactly
    // what breaks the pool, so the number just set here wins everywhere, no exceptions.
    // (Skipped entirely when fanOutAvailability === false — see this function's own param doc.)
    if (input.fanOutAvailability !== false) {
      const siblingIds = await this.otherConnectionIds(input.ratePlanId, input.otaConnectionId);
      for (const connId of siblingIds) {
        const existingRows = await this.prisma.inventoryRate.findMany({
          where: { ratePlanId: input.ratePlanId, otaConnectionId: connId, date: input.date },
        });
        const existingByTier = new Map(existingRows.map((r) => [r.occupancyTier, r]));
        for (const tier of input.tiers) {
          await this.upsertBulkCell(
            input.ratePlanId,
            connId,
            input.date,
            { occupancyTier: tier.occupancyTier, availability: tier.availability ?? 0 },
            input.changedBy,
            existingByTier.get(tier.occupancyTier),
          );
        }
      }
    }

    await this.logCmEvent(input.otaConnectionId, 'RATE_VALUE_OVERRIDE', input.changedBy, {
      ratePlanId: input.ratePlanId,
      otaConnectionId: input.otaConnectionId,
      date: input.date.toISOString().slice(0, 10),
      price: input.tiers[0]?.price ?? null,
      availability: input.tiers[0]?.availability ?? null,
    });
    return result;
  }

  /**
   * Undoes a one-time value override (§ user request — "open karne ka procedure") by
   * deleting that cell's row outright, rather than guessing at what the bulk-update price
   * "should" revert to (nothing tracks that). The cell goes back to its plain unset state
   * — same as a date nobody has ever touched — until the next bulk update or override sets
   * it again. Only deletes rows this override actually created (`source: value_override`),
   * so it can never accidentally delete a bulk-update-sourced cell.
   */
  async clearValueOverride(input: { ratePlanId: string; otaConnectionId: string; date: Date; occupancyTier: number; actorId: string }) {
    const { count } = await this.prisma.inventoryRate.deleteMany({
      where: {
        ratePlanId: input.ratePlanId,
        otaConnectionId: input.otaConnectionId,
        date: input.date,
        occupancyTier: input.occupancyTier,
        source: RateSource.value_override,
      },
    });
    if (count > 0) {
      await this.logCmEvent(input.otaConnectionId, 'RATE_VALUE_OVERRIDE', input.actorId, {
        ratePlanId: input.ratePlanId,
        otaConnectionId: input.otaConnectionId,
        date: input.date.toISOString().slice(0, 10),
        cleared: true,
      });
    }
    return { cleared: count > 0 };
  }

  /**
   * Every still-relevant value override and active restriction for the hotel, from today
   * onward (§ user request — "ek log mein dikhna chahiye, future dates ke liye, otherwise
   * bhool jaunga"). Past dates are excluded on purpose: an override on a date that's already
   * gone isn't something anyone needs reminding about.
   */
  async listActiveOverrides(hotelId: string) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const [overrides, restrictions] = await Promise.all([
      this.prisma.inventoryRate.findMany({
        where: { source: RateSource.value_override, date: { gte: today }, ratePlan: { roomCategory: { hotelId } } },
        include: { ratePlan: { include: { roomCategory: true } }, otaConnection: true },
        orderBy: { date: 'asc' },
      }),
      this.prisma.restriction.findMany({
        where: {
          date: { gte: today },
          ratePlan: { roomCategory: { hotelId } },
          OR: [
            { channelBlocked: true },
            { ratePlanClosed: true },
            { closedToArrival: true },
            { closedToDeparture: true },
            { minLos: { not: null } },
            { maxLos: { not: null } },
            { bookableNights: { not: null } },
            { minAdvanceDays: { not: null } },
            { maxAdvanceDays: { not: null } },
            { minLosArrival: { not: null } },
            { maxLosArrival: { not: null } },
            { exactLosArrival: { not: null } },
            { cap: { not: null } },
            { cutoffHours: { not: null } },
            { allocationCount: { not: null } },
          ],
        },
        include: { ratePlan: { include: { roomCategory: true } }, otaConnection: true },
        orderBy: { date: 'asc' },
      }),
    ]);
    return { overrides, restrictions };
  }

  /**
   * § user request — "agar by any chance ye action hua hai to yahan show hoga": a visible
   * history of every value-override and restriction change (set AND cleared) over the last
   * `days`, not just what's currently active — clearing something used to make it vanish
   * without a trace from "Upcoming", which read as the action itself being undone rather
   * than just its live effect. Reuses the same audit trail every CM write already logs via
   * `logCmEvent`, just read back and labeled.
   */
  async listRecentActivity(hotelId: string, days: number) {
    const since = new Date(Date.now() - days * 86400000);
    const logs = await this.prisma.auditLog.findMany({
      where: { hotelId, eventType: { in: ['RATE_VALUE_OVERRIDE', 'RESTRICTION_UPDATED'] }, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
    });
    if (logs.length === 0) return [];

    const asRecord = (d: unknown) => (d && typeof d === 'object' ? (d as Record<string, unknown>) : {});
    const asString = (v: unknown) => (typeof v === 'string' ? v : undefined);

    const ratePlanIds = [...new Set(logs.map((l) => asString(asRecord(l.detail).ratePlanId)).filter((v): v is string => Boolean(v)))];
    const otaConnectionIds = [...new Set(logs.map((l) => asString(asRecord(l.detail).otaConnectionId)).filter((v): v is string => Boolean(v)))];

    const [ratePlans, connections] = await Promise.all([
      this.prisma.ratePlan.findMany({ where: { id: { in: ratePlanIds } }, include: { roomCategory: true } }),
      this.prisma.otaConnection.findMany({ where: { id: { in: otaConnectionIds } } }),
    ]);
    const ratePlanById = new Map(ratePlans.map((rp) => [rp.id, rp]));
    const connectionById = new Map(connections.map((c) => [c.id, c]));

    return logs.map((l) => {
      const detail = asRecord(l.detail);
      const ratePlan = asString(detail.ratePlanId) ? ratePlanById.get(asString(detail.ratePlanId)!) : undefined;
      const connection = asString(detail.otaConnectionId) ? connectionById.get(asString(detail.otaConnectionId)!) : undefined;
      return {
        id: l.id,
        createdAt: l.createdAt,
        eventType: l.eventType,
        date: asString(detail.date) ?? null,
        roomCategoryName: ratePlan?.roomCategory.name ?? null,
        ratePlanName: ratePlan?.name ?? null,
        otaCode: connection?.otaCode ?? null,
        cleared: detail.cleared === true,
        price: typeof detail.price === 'number' ? detail.price : null,
        availability: typeof detail.availability === 'number' ? detail.availability : null,
        channelBlocked: typeof detail.channelBlocked === 'boolean' ? detail.channelBlocked : null,
      };
    });
  }

  /**
   * §7 Phase 1 #2. `explicitTiers` populates cells from scratch (first-time set);
   * `adjust` changes existing prices by %/fixed amount, only where a row already
   * exists. Skips any cell whose current source is value_override unless
   * `overrideValueOverrides` is set (§5.5's design rule).
   */
  async bulkUpdate(input: {
    ratePlanId: string;
    otaConnectionId: string;
    startDate: Date;
    endDate: Date;
    daysOfWeek?: number[]; // 0=Sunday .. 6=Saturday; omit = every day
    explicitTiers?: TierSet[];
    adjust?: { mode: 'percent' | 'fixed'; direction: 'increase' | 'decrease'; value: number };
    overrideValueOverrides?: boolean;
    changedBy: string;
  }) {
    const dates = datesInRange(input.startDate, input.endDate, input.daysOfWeek);
    let updated = 0;
    let skippedValueOverrides = 0;

    // Same pooled-availability rule as setValueOverride — resolved once up front rather than per
    // date/tier, and only when this call actually touches availability at all (Rate Update's own
    // price-only calls never do, so they stay exactly as cheap as before).
    const touchesAvailability = input.explicitTiers?.some((t) => t.availability !== undefined) ?? false;
    const siblingIds = touchesAvailability ? await this.otherConnectionIds(input.ratePlanId, input.otaConnectionId) : [];

    for (const date of dates) {
      const existingRows = await this.prisma.inventoryRate.findMany({
        where: { ratePlanId: input.ratePlanId, otaConnectionId: input.otaConnectionId, date },
      });
      const existingByTier = new Map(existingRows.map((r) => [r.occupancyTier, r]));

      if (input.explicitTiers) {
        for (const tier of input.explicitTiers) {
          const existing = existingByTier.get(tier.occupancyTier);
          if (existing?.source === RateSource.value_override && !input.overrideValueOverrides) {
            skippedValueOverrides++;
            continue;
          }
          await this.upsertBulkCell(input.ratePlanId, input.otaConnectionId, date, tier, input.changedBy, existing);
          updated++;

          if (tier.availability !== undefined && siblingIds.length > 0) {
            const siblingRows = await this.prisma.inventoryRate.findMany({
              where: { ratePlanId: input.ratePlanId, otaConnectionId: { in: siblingIds }, date, occupancyTier: tier.occupancyTier },
            });
            const siblingByConn = new Map(siblingRows.map((r) => [r.otaConnectionId, r]));
            for (const connId of siblingIds) {
              await this.upsertBulkCell(
                input.ratePlanId,
                connId,
                date,
                { occupancyTier: tier.occupancyTier, availability: tier.availability },
                input.changedBy,
                siblingByConn.get(connId),
              );
            }
          }
        }
      } else if (input.adjust) {
        for (const existing of existingRows) {
          if (existing.source === RateSource.value_override && !input.overrideValueOverrides) {
            skippedValueOverrides++;
            continue;
          }
          const current = Number(existing.price);
          const delta = input.adjust.mode === 'percent' ? current * (input.adjust.value / 100) : input.adjust.value;
          const newPrice = input.adjust.direction === 'increase' ? current + delta : current - delta;
          await this.prisma.inventoryRate.update({
            where: { id: existing.id },
            data: {
              price: Math.max(0, Math.round(newPrice)),
              source: RateSource.bulk_update,
              changedBy: input.changedBy,
              changedAt: new Date(),
            },
          });
          updated++;
        }
      }
    }

    if (updated > 0) {
      await this.logCmEvent(input.otaConnectionId, 'RATE_BULK_UPDATE', input.changedBy, {
        ratePlanId: input.ratePlanId,
        datesProcessed: dates.length,
        cellsUpdated: updated,
      });
    }
    return { datesProcessed: dates.length, cellsUpdated: updated, cellsSkippedValueOverride: skippedValueOverrides };
  }

  /**
   * Rate Update and Inventory Update are separate pages/actions now (each
   * sends only price+extras, or only availability) — merges whichever half
   * is omitted from the existing row rather than clobbering it. A brand-new
   * cell with no existing row and no value for a required field defaults
   * to 0, which is deliberately visible/wrong so the owner notices and fixes
   * it via the other page, rather than silently refusing to create the row.
   */
  private async upsertBulkCell(
    ratePlanId: string,
    otaConnectionId: string,
    date: Date,
    tier: TierSet,
    changedBy: string,
    existing?: InventoryRate,
  ) {
    const price = tier.price ?? existing?.price ?? 0;
    const availability = tier.availability ?? existing?.availability ?? 0;
    const extraAdultPrice = tier.extraAdultPrice ?? existing?.extraAdultPrice ?? undefined;
    const child1Price = tier.child1Price ?? existing?.child1Price ?? undefined;
    const child2Price = tier.child2Price ?? existing?.child2Price ?? undefined;

    return this.prisma.inventoryRate.upsert({
      where: {
        ratePlanId_otaConnectionId_date_occupancyTier: { ratePlanId, otaConnectionId, date, occupancyTier: tier.occupancyTier },
      },
      create: {
        ratePlanId,
        otaConnectionId,
        date,
        occupancyTier: tier.occupancyTier,
        price,
        extraAdultPrice,
        child1Price,
        child2Price,
        availability,
        source: RateSource.bulk_update,
        changedBy,
      },
      update: {
        price,
        extraAdultPrice,
        child1Price,
        child2Price,
        availability,
        source: RateSource.bulk_update,
        changedBy,
        changedAt: new Date(),
      },
    });
  }

  /** §7 Phase 1 #15 — CSV export of the grid for one rate plan/channel/date range. */
  async exportGridCsv(input: { ratePlanId: string; otaConnectionId: string; startDate: Date; endDate: Date }) {
    const rates = await this.prisma.inventoryRate.findMany({
      where: {
        ratePlanId: input.ratePlanId,
        otaConnectionId: input.otaConnectionId,
        date: { gte: input.startDate, lte: input.endDate },
      },
      orderBy: [{ date: 'asc' }, { occupancyTier: 'asc' }],
    });

    const header = 'date,occupancy_tier,price,extra_adult_price,child_1_price,child_2_price,availability,source,gst_label';
    const rows = rates.map((r) => {
      const gst = computeGstSlab(Number(r.price));
      return [
        r.date.toISOString().slice(0, 10),
        r.occupancyTier,
        r.price,
        r.extraAdultPrice ?? '',
        r.child1Price ?? '',
        r.child2Price ?? '',
        r.availability,
        r.source,
        gst.label,
      ].join(',');
    });
    return [header, ...rows].join('\n');
  }

  async upsertRestriction(
    input: {
      ratePlanId: string;
      otaConnectionId: string;
      date: Date;
      actorId: string;
    } & Partial<
      Omit<Prisma.RestrictionUncheckedCreateInput, 'ratePlanId' | 'otaConnectionId' | 'date' | 'id'>
    >,
  ) {
    const { ratePlanId, otaConnectionId, date, actorId, ...fields } = input;
    const result = await this.prisma.restriction.upsert({
      where: { ratePlanId_otaConnectionId_date: { ratePlanId, otaConnectionId, date } },
      create: { ratePlanId, otaConnectionId, date, ...fields },
      update: fields,
    });
    await this.logCmEvent(otaConnectionId, 'RESTRICTION_UPDATED', actorId, {
      ratePlanId,
      otaConnectionId,
      date: date.toISOString().slice(0, 10),
      channelBlocked: fields.channelBlocked ?? null,
    });
    return result;
  }
}
