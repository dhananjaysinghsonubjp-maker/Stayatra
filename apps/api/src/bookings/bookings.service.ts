import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BookingStatus, PaymentMethod } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../common/audit.service.js';

const CHECK_IN_IDEMPOTENCY_WINDOW_MS = 1000 * 60 * 5;

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

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
  async checkInWalkIn(input: {
    hotelId: string;
    roomId: string;
    guestName: string;
    guestPhone?: string;
    ratePlanId?: string;
    checkIn: Date;
    checkOut: Date;
    nights: number;
    totalAmount: number;
    actorId: string;
  }) {
    if (!/^\d{10}$/.test(input.guestPhone ?? '') && input.guestPhone) {
      throw new BadRequestException('Guest phone must be exactly 10 digits or blank');
    }
    if (input.nights < 1) throw new BadRequestException('Nights must be at least 1');

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

    const booking = await this.prisma.$transaction(async (tx) => {
      const created = await tx.booking.create({
        data: {
          hotelId: input.hotelId,
          guestName: input.guestName,
          guestPhone: input.guestPhone,
          roomCategoryId: room.roomCategoryId!,
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

  /** §8.3 — an existing confirmed reservation (direct or OTA) arrives and is assigned a physical room. */
  async checkInReservation(input: { bookingId: string; roomId: string; actorId: string }) {
    const [booking, room] = await Promise.all([
      this.prisma.booking.findUniqueOrThrow({ where: { id: input.bookingId } }),
      this.prisma.room.findUniqueOrThrow({ where: { id: input.roomId } }),
    ]);
    if (booking.status === BookingStatus.checked_in) return booking; // idempotent
    if (booking.status !== BookingStatus.confirmed) throw new ConflictException(`Booking is ${booking.status}, cannot check in`);
    if (room.status !== 'available') throw new ConflictException('Room is not available');
    if (room.roomCategoryId !== booking.roomCategoryId) throw new ConflictException('Room category does not match the reservation');

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.booking.update({ where: { id: input.bookingId }, data: { status: BookingStatus.checked_in } });
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
}
