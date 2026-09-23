import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BookingStatus, Gender, IdType, PaymentMethod } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../common/audit.service.js';
import { computeCleaningDeadline, isDelayed } from '../common/delay.js';
import { GuestsService } from '../guests/guests.service.js';

const CHECK_IN_IDEMPOTENCY_WINDOW_MS = 1000 * 60 * 5;

export interface CheckInGuestDetails {
  guestId?: string;
  title?: string;
  guestName: string;
  guestPhone?: string;
  email?: string;
  gender?: Gender;
  dateOfBirth?: Date;
  address?: string;
  country?: string;
  state?: string;
  city?: string;
  pincode?: string;
  idType: IdType;
  idNumber: string;
  idPhotoPath?: string;
}

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly guests: GuestsService,
  ) {}

  /**
   * Links (or creates/updates) a reusable Guest profile for this check-in.
   * Only attempted when a phone number is given — phone is the de-facto
   * lookup key (§ — reference UI's "saved guest" autofill), so without one
   * there's nothing reliable to match a repeat guest against later.
   */
  private async linkGuestProfile(hotelId: string, details: CheckInGuestDetails): Promise<string | undefined> {
    if (!details.guestPhone) return details.guestId;
    const { id } = await this.guests.upsertForCheckIn(hotelId, {
      guestId: details.guestId,
      title: details.title,
      name: details.guestName,
      phone: details.guestPhone,
      email: details.email,
      gender: details.gender,
      dateOfBirth: details.dateOfBirth,
      address: details.address,
      country: details.country,
      state: details.state,
      city: details.city,
      pincode: details.pincode,
      idType: details.idType,
      idNumber: details.idNumber,
      idPhotoPath: details.idPhotoPath,
    });
    return id;
  }

  /**
   * §8.4 — Front Desk creating a future-dated reservation on behalf of someone
   * who called/walked in to book ahead. status='confirmed', no room assigned yet.
   *
   * Note: restrictions (§5.1) are keyed per-OTA-connection, which doesn't apply
   * to a direct booking. As a stand-in for "same availability rules apply,"
   * this checks category-level room capacity (active rooms in the category vs.
   * overlapping confirmed/checked_in bookings) rather than OTA restrictions —
   * flag if a stricter rule is wanted here.
   */
  async createManualBooking(input: {
    hotelId: string;
    guestName: string;
    guestPhone?: string;
    roomCategoryId: string;
    ratePlanId?: string;
    checkIn: Date;
    checkOut: Date;
    nights: number;
    totalAmount: number;
  }) {
    const [totalRooms, overlappingBookings] = await Promise.all([
      this.prisma.room.count({ where: { hotelId: input.hotelId, roomCategoryId: input.roomCategoryId, active: true } }),
      this.prisma.booking.count({
        where: {
          hotelId: input.hotelId,
          roomCategoryId: input.roomCategoryId,
          status: { in: [BookingStatus.confirmed, BookingStatus.checked_in] },
          checkIn: { lt: input.checkOut },
          checkOut: { gt: input.checkIn },
        },
      }),
    ]);
    if (overlappingBookings >= totalRooms) {
      throw new ConflictException('No rooms available in this category for the selected dates');
    }

    return this.prisma.booking.create({
      data: {
        hotelId: input.hotelId,
        guestName: input.guestName,
        guestPhone: input.guestPhone,
        roomCategoryId: input.roomCategoryId,
        ratePlanId: input.ratePlanId,
        checkIn: input.checkIn,
        checkOut: input.checkOut,
        nights: input.nights,
        totalAmount: input.totalAmount,
        status: BookingStatus.confirmed,
        source: 'direct',
      },
    });
  }

  /** §8.3 — guest standing at the desk right now, no prior reservation. Idempotent against double-submit. */
  async checkInWalkIn(
    input: CheckInGuestDetails & {
      hotelId: string;
      roomId: string;
      purposeOfStay?: string;
      ratePlanId?: string;
      checkIn: Date;
      checkOut: Date;
      nights: number;
      totalAmount: number;
      actorId: string;
    },
  ) {
    if (!/^\d{10}$/.test(input.guestPhone ?? '') && input.guestPhone) {
      throw new BadRequestException('Guest phone must be exactly 10 digits or blank');
    }
    if (input.nights < 1) throw new BadRequestException('Nights must be at least 1');
    if (!input.idNumber.trim()) throw new BadRequestException('Guest ID number is required at check-in');

    const since = new Date(Date.now() - CHECK_IN_IDEMPOTENCY_WINDOW_MS);
    const recentDuplicate = await this.prisma.booking.findFirst({
      where: {
        hotelId: input.hotelId,
        guestName: input.guestName,
        status: BookingStatus.checked_in,
        createdAt: { gte: since },
        room: { id: input.roomId },
      },
    });
    if (recentDuplicate) return recentDuplicate; // same request landed already — don't double-book

    const room = await this.prisma.room.findUniqueOrThrow({ where: { id: input.roomId } });
    if (room.status !== 'available') throw new ConflictException('Room is not available');
    if (!room.roomCategoryId) throw new ConflictException('Room has no category assigned yet — sort it during onboarding first');

    const guestId = await this.linkGuestProfile(input.hotelId, input);

    const booking = await this.prisma.$transaction(async (tx) => {
      const created = await tx.booking.create({
        data: {
          hotelId: input.hotelId,
          guestName: input.guestName,
          guestPhone: input.guestPhone,
          idType: input.idType,
          idNumber: input.idNumber,
          guestId,
          purposeOfStay: input.purposeOfStay,
          roomCategoryId: room.roomCategoryId!,
          assignedRoomId: input.roomId,
          ratePlanId: input.ratePlanId,
          checkIn: input.checkIn,
          checkOut: input.checkOut,
          nights: input.nights,
          totalAmount: input.totalAmount,
          status: BookingStatus.checked_in,
          source: 'walk_in',
        },
      });
      await tx.room.update({
        where: { id: input.roomId },
        data: { status: 'occupied', currentStayId: created.id, statusChangedAt: new Date() },
      });
      return created;
    });

    await this.audit.log({ hotelId: input.hotelId, eventType: 'CHECK_IN', actorId: input.actorId, subjectId: booking.id });
    return booking;
  }

  /**
   * §8.3 — an existing confirmed reservation (direct or OTA) arrives and is
   * assigned a physical room. A manual booking (§8.4) doesn't collect full
   * guest details at creation time (that's a phone/advance booking), so
   * they're captured here, at the moment the guest is physically present.
   */
  async checkInReservation(
    input: CheckInGuestDetails & { bookingId: string; roomId: string; purposeOfStay?: string; actorId: string },
  ) {
    const [booking, room] = await Promise.all([
      this.prisma.booking.findUniqueOrThrow({ where: { id: input.bookingId } }),
      this.prisma.room.findUniqueOrThrow({ where: { id: input.roomId } }),
    ]);
    if (booking.status === BookingStatus.checked_in) return booking; // idempotent
    if (booking.status !== BookingStatus.confirmed) throw new ConflictException(`Booking is ${booking.status}, cannot check in`);
    if (!input.idNumber.trim()) throw new BadRequestException('Guest ID number is required at check-in');
    if (room.status !== 'available') throw new ConflictException('Room is not available');
    if (room.roomCategoryId !== booking.roomCategoryId) throw new ConflictException('Room category does not match the reservation');

    const guestId = await this.linkGuestProfile(booking.hotelId, input);

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.booking.update({
        where: { id: input.bookingId },
        data: {
          status: BookingStatus.checked_in,
          assignedRoomId: input.roomId,
          idType: input.idType,
          idNumber: input.idNumber,
          guestId,
          purposeOfStay: input.purposeOfStay,
          guestPhone: input.guestPhone ?? booking.guestPhone,
        },
      });
      await tx.room.update({
        where: { id: input.roomId },
        data: { status: 'occupied', currentStayId: result.id, statusChangedAt: new Date() },
      });
      return result;
    });

    await this.audit.log({ hotelId: booking.hotelId, eventType: 'CHECK_IN', actorId: input.actorId, subjectId: booking.id });
    return updated;
  }

  /**
   * §5.2 / §8.5 — never alters room or booking status; that's the whole point.
   * Refuses to collect more than the outstanding balance.
   */
  async addPayment(input: { bookingId: string; amount: number; method: PaymentMethod; collectedBy: string }) {
    if (input.amount <= 0) throw new BadRequestException('Amount must be positive');

    return this.prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findUniqueOrThrow({ where: { id: input.bookingId } });
      const alreadyPaid = Number(booking.paidAmount ?? 0);
      const outstanding = Number(booking.totalAmount) - alreadyPaid;
      if (input.amount > outstanding + 0.01) {
        throw new ConflictException(`Cannot collect more than the outstanding balance (₹${outstanding.toFixed(2)})`);
      }

      const payment = await tx.payment.create({
        data: { bookingId: input.bookingId, amount: input.amount, method: input.method, collectedBy: input.collectedBy },
      });
      const updatedBooking = await tx.booking.update({
        where: { id: input.bookingId },
        data: { paidAmount: alreadyPaid + input.amount, paymentMethod: booking.paymentMethod ?? input.method },
      });

      await this.audit.log({
        hotelId: booking.hotelId,
        eventType: 'PAYMENT_RECEIVED',
        actorId: input.collectedBy,
        subjectId: booking.id,
        detail: { amount: input.amount, method: input.method },
      });

      return { payment, booking: updatedBooking };
    });
  }

  async listReservations(input: { hotelId: string; from?: Date; to?: Date }) {
    return this.prisma.booking.findMany({
      where: {
        hotelId: input.hotelId,
        ...(input.from || input.to
          ? { checkIn: { gte: input.from ?? undefined, lte: input.to ?? undefined } }
          : {}),
      },
      include: { payments: true },
      orderBy: { checkIn: 'asc' },
    });
  }

  /** Confirmed reservations not yet arrived — the "check in an existing booking" search list (§8.3/§8.4). */
  async listUpcomingReservations(input: { hotelId: string; roomCategoryId?: string }) {
    return this.prisma.booking.findMany({
      where: { hotelId: input.hotelId, status: BookingStatus.confirmed, roomCategoryId: input.roomCategoryId },
      orderBy: { checkIn: 'asc' },
    });
  }

  /** Room board — physical rooms with live status + (redacted, per role, at the router layer) current guest. */
  async getRoomBoard(hotelId: string) {
    return this.prisma.room.findMany({
      where: { hotelId, active: true },
      include: { roomCategory: true, currentStay: true },
      orderBy: { roomNumber: 'asc' },
    });
  }

  async getBooking(bookingId: string) {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId }, include: { payments: true } });
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }

  /** In-House Guests — every currently-occupied room with its live stay, including derived Delayed state (§8.7). */
  async listInHouse(hotelId: string) {
    const rooms = await this.prisma.room.findMany({
      where: { hotelId, status: 'occupied', currentStayId: { not: null } },
      include: { roomCategory: true, currentStay: { include: { payments: true } } },
      orderBy: { roomNumber: 'asc' },
    });

    return rooms
      .filter((r) => r.currentStay)
      .map((r) => {
        const stay = r.currentStay!;
        return {
          room: { id: r.id, roomNumber: r.roomNumber, roomCategory: r.roomCategory },
          booking: stay,
          delayed: isDelayed(stay.checkIn, stay.checkOut, stay.delayResolvedAt),
          cleaningDeadline: computeCleaningDeadline(stay.checkIn, stay.checkOut),
        };
      });
  }

  /** Owner-only; note hidden from housekeeping at the router layer, same pattern as cleaning discrepancies (§8.7). */
  async resolveDelay(input: { bookingId: string; resolvedBy: string; note: string }) {
    const booking = await this.prisma.booking.update({
      where: { id: input.bookingId },
      data: { delayResolvedAt: new Date(), delayResolvedBy: input.resolvedBy, delayResolvedNote: input.note },
    });
    await this.audit.log({ hotelId: booking.hotelId, eventType: 'DELAY_RESOLVED', actorId: input.resolvedBy, subjectId: booking.id });
    return booking;
  }
}
