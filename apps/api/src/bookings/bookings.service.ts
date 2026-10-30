import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BookingSource, BookingStatus, Gender, IdType, PaymentMethod } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../common/audit.service.js';
import { computeCleaningDeadline, isDelayed } from '../common/delay.js';
import { computeInvoiceTotals } from '../common/invoice.js';
import { GuestsService } from '../guests/guests.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { RatesService } from '../rates/rates.service.js';

const CHECK_IN_IDEMPOTENCY_WINDOW_MS = 1000 * 60 * 5;
const BOOKING_EDIT_WINDOW_MS = 1000 * 60 * 60; // 1 hour after check-in (§ added beyond MD spec, at user request)

function dateLabel(d: Date) {
  return d.toISOString().slice(0, 10);
}

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
  idPhotoBackPath?: string;
}

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly guests: GuestsService,
    private readonly notifications: NotificationsService,
    private readonly rates: RatesService,
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
      idPhotoBackPath: details.idPhotoBackPath,
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

    const booking = await this.prisma.booking.create({
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
    await this.rates.adjustAvailabilityForStay({
      hotelId: input.hotelId,
      roomCategoryId: input.roomCategoryId,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      delta: -1,
    });
    return booking;
  }

  /** Every physical room, each flagged with whether it's free for the given date range — the
   * room-number picker grid in the multi-room reservation flow needs the whole inventory (so it
   * can show "already booked" rooms as disabled, not just omit them). */
  async listRoomsWithAvailability(input: { hotelId: string; checkIn: Date; checkOut: Date }) {
    const [rooms, overlapping] = await Promise.all([
      this.prisma.room.findMany({ where: { hotelId: input.hotelId, active: true }, include: { roomCategory: true }, orderBy: { roomNumber: 'asc' } }),
      this.prisma.booking.findMany({
        where: {
          hotelId: input.hotelId,
          status: { in: [BookingStatus.confirmed, BookingStatus.checked_in] },
          assignedRoomId: { not: null },
          checkIn: { lt: input.checkOut },
          checkOut: { gt: input.checkIn },
        },
        select: { assignedRoomId: true },
      }),
    ]);
    const bookedRoomIds = new Set(overlapping.map((b) => b.assignedRoomId));
    return rooms.map((r) => ({ ...r, available: !bookedRoomIds.has(r.id) }));
  }

  /**
   * §user request, with a reference app's multi-room Create Reservation flow as the target —
   * one reservation can book several SPECIFIC rooms at once (not just a category, picked later
   * at check-in like the single-room flow). Each room becomes its own Booking row (so it keeps
   * its own status, its own check-in, its own payments — "partial check-in" is just checking in
   * some of these rows and not others) sharing one `reservationGroupId` so the UI can show them
   * as one umbrella reservation. An optional advance payment is split across the rooms by each
   * room's share of the total, same proportion the front desk sees in the create form.
   */
  async createMultiRoomReservation(input: {
    hotelId: string;
    source: BookingSource;
    checkIn: Date;
    checkOut: Date;
    guestName: string;
    guestPhone?: string;
    guestEmail?: string;
    specialRequest?: string;
    rooms: {
      roomId: string;
      totalAmount: number;
      ratePlanId?: string;
      discountAmount?: number;
      gstExempt?: boolean;
      lineItems?: { description: string; quantity: number; unitPrice: number }[];
      checkIn?: Date;
      checkOut?: Date;
    }[];
    advanceAmount?: number;
    paymentMethod?: PaymentMethod;
    // §user request — "corporate booking vala nahi dala hai": set right at creation, applied to
    // every room in the group (same billToCompany* columns setCompanyBilling already uses).
    companyName?: string;
    companyTaxIdType?: string;
    companyGstin?: string;
    companyPhone?: string;
    companyEmail?: string;
    companyAddress?: string;
    companyCountry?: string;
    companyState?: string;
    companyCity?: string;
    companyPincode?: string;
    actorId: string;
  }) {
    if (input.rooms.length === 0) throw new BadRequestException('Select at least one room');
    const defaultNights = Math.round((input.checkOut.getTime() - input.checkIn.getTime()) / 86400000);
    if (defaultNights < 1) throw new BadRequestException('Check-out must be after check-in');

    // §user request — a bulk/wedding reservation's rooms don't always share the same stay (one
    // room for 1 night, another for 3); each room falls back to the reservation-level dates
    // above when it doesn't set its own.
    const roomStays = input.rooms.map((r) => {
      const effCheckIn = r.checkIn ?? input.checkIn;
      const effCheckOut = r.checkOut ?? input.checkOut;
      const effNights = Math.round((effCheckOut.getTime() - effCheckIn.getTime()) / 86400000);
      if (effNights < 1) throw new BadRequestException('Check-out must be after check-in for every room');
      return { ...r, checkIn: effCheckIn, checkOut: effCheckOut, nights: effNights };
    });

    const roomIds = input.rooms.map((r) => r.roomId);
    const rooms = await this.prisma.room.findMany({ where: { id: { in: roomIds }, hotelId: input.hotelId } });
    if (rooms.length !== roomIds.length) throw new NotFoundException('One or more selected rooms were not found');

    // Checked per room (not one batched query) since each room may now have its own date range.
    for (const stay of roomStays) {
      const overlapping = await this.prisma.booking.findFirst({
        where: {
          hotelId: input.hotelId,
          assignedRoomId: stay.roomId,
          status: { in: [BookingStatus.confirmed, BookingStatus.checked_in] },
          checkIn: { lt: stay.checkOut },
          checkOut: { gt: stay.checkIn },
        },
        include: { assignedRoom: true },
      });
      if (overlapping) {
        throw new ConflictException(`Room ${overlapping.assignedRoom?.roomNumber} already has a reservation for these dates`);
      }
    }

    const reservationGroupId = crypto.randomUUID();
    const grandTotal = input.rooms.reduce((sum, r) => sum + r.totalAmount, 0);

    const bookings = await this.prisma.$transaction(async (tx) => {
      const created = [];
      for (const r of roomStays) {
        const room = rooms.find((room) => room.id === r.roomId)!;
        const share = input.advanceAmount ? (r.totalAmount / grandTotal) * input.advanceAmount : 0;
        const booking = await tx.booking.create({
          data: {
            hotelId: input.hotelId,
            reservationGroupId,
            guestName: input.guestName,
            // §user request — only meaningful once there's more than one room to tell apart;
            // an ordinary 1-room booking through this same flow has no separate "booker".
            bookedByName: input.rooms.length > 1 ? input.guestName : undefined,
            bookedByPhone: input.rooms.length > 1 ? input.guestPhone : undefined,
            guestPhone: input.guestPhone,
            guestEmail: input.guestEmail,
            specialRequest: input.specialRequest,
            roomCategoryId: room.roomCategoryId!,
            assignedRoomId: room.id,
            ratePlanId: r.ratePlanId,
            checkIn: r.checkIn,
            checkOut: r.checkOut,
            nights: r.nights,
            totalAmount: r.totalAmount,
            discountAmount: r.discountAmount,
            gstExempt: r.gstExempt ?? false,
            status: BookingStatus.confirmed,
            source: input.source,
            paidAmount: share > 0 ? share : undefined,
            paymentMethod: share > 0 ? input.paymentMethod : undefined,
            billToCompanyName: input.companyName,
            billToCompanyTaxIdType: input.companyName ? input.companyTaxIdType : undefined,
            billToCompanyGstin: input.companyName ? input.companyGstin : undefined,
            billToCompanyPhone: input.companyName ? input.companyPhone : undefined,
            billToCompanyEmail: input.companyName ? input.companyEmail : undefined,
            billToCompanyAddress: input.companyName ? input.companyAddress : undefined,
            billToCompanyCountry: input.companyName ? input.companyCountry : undefined,
            billToCompanyState: input.companyName ? input.companyState : undefined,
            billToCompanyCity: input.companyName ? input.companyCity : undefined,
            billToCompanyPincode: input.companyName ? input.companyPincode : undefined,
          },
        });
        // §user request — the same "+ Add Extra Charges" line items check-in already supports
        // (extra mattress, food, damage, etc.), now also settable upfront when the reservation
        // itself is created, not just later at check-in.
        if (r.lineItems?.length) {
          await tx.invoiceLineItem.createMany({
            data: r.lineItems.map((li) => ({
              bookingId: booking.id,
              description: li.description,
              quantity: li.quantity,
              unitPrice: li.unitPrice,
              amount: li.quantity * li.unitPrice,
            })),
          });
        }
        if (share > 0 && input.paymentMethod) {
          await tx.payment.create({
            data: { bookingId: booking.id, amount: share, method: input.paymentMethod, collectedBy: input.actorId },
          });
        }
        created.push(booking);
      }
      return created;
    });

    // §user request — "rooms get automatically blocked on all OTA": every other booking-creation
    // path (createManualBooking, checkInWalkIn, ...) already calls this; this one was missing it,
    // so a multi-room reservation never actually held its rooms against OTA sale.
    // §bugfix — grouped by category *and* date range, not just category: a bulk/wedding
    // reservation can give individual rooms their own stay dates (roomStays above, the "per-room
    // date chip" feature), but this used to always decrement the group-level input.checkIn/
    // checkOut for every room regardless — so a room with its own different dates would adjust
    // availability for the wrong nights entirely.
    const deltaByCategoryStay = new Map<string, { roomCategoryId: string; checkIn: Date; checkOut: Date; delta: number }>();
    for (const r of roomStays) {
      const room = rooms.find((rm) => rm.id === r.roomId);
      if (!room?.roomCategoryId) continue;
      const key = `${room.roomCategoryId}|${r.checkIn.toISOString()}|${r.checkOut.toISOString()}`;
      const existing = deltaByCategoryStay.get(key);
      if (existing) existing.delta -= 1;
      else deltaByCategoryStay.set(key, { roomCategoryId: room.roomCategoryId, checkIn: r.checkIn, checkOut: r.checkOut, delta: -1 });
    }
    await Promise.all(
      [...deltaByCategoryStay.values()].map((d) =>
        this.rates.adjustAvailabilityForStay({ hotelId: input.hotelId, roomCategoryId: d.roomCategoryId, checkIn: d.checkIn, checkOut: d.checkOut, delta: d.delta }),
      ),
    );

    await this.audit.log({
      hotelId: input.hotelId,
      eventType: 'RESERVATION_CREATED',
      actorId: input.actorId,
      subjectId: reservationGroupId,
      detail: { guestName: input.guestName, rooms: rooms.map((r) => r.roomNumber) },
    });

    return bookings;
  }

  /**
   * §user request, with a reference app's own calendar-bar "Edit reservation" (opened from the
   * same View/Edit/Start check-in menu its tooltip's bar click shows) as the target — change an
   * upcoming reservation's guest details, dates, rooms, or pricing after it's already been
   * created. Scoped to status `confirmed` across the whole group; once any room has checked in,
   * corrections go through updateBooking's own 1-hour post-check-in window instead, which this
   * intentionally never touches.
   *
   * A submitted room is matched to an existing Booking row by roomId and updated in place (keeps
   * its id, so its own payments/line items/audit trail survive); a room with no existing match is
   * created fresh under the same reservationGroupId (exactly like createMultiRoomReservation); an
   * existing room missing from the submitted list is removed — but only if nothing's been paid
   * against it (Payment cascades on Booking delete), so a part-paid room can't silently vanish
   * along with its own ledger.
   */
  async updateReservationGroup(input: {
    reservationGroupId: string;
    hotelId: string;
    source: BookingSource;
    checkIn: Date;
    checkOut: Date;
    guestName: string;
    guestPhone?: string;
    guestEmail?: string;
    specialRequest?: string;
    rooms: {
      roomId: string;
      totalAmount: number;
      ratePlanId?: string;
      discountAmount?: number;
      gstExempt?: boolean;
      lineItems?: { description: string; quantity: number; unitPrice: number }[];
      checkIn?: Date;
      checkOut?: Date;
    }[];
    companyName?: string;
    companyTaxIdType?: string;
    companyGstin?: string;
    companyPhone?: string;
    companyEmail?: string;
    companyAddress?: string;
    companyCountry?: string;
    companyState?: string;
    companyCity?: string;
    companyPincode?: string;
    actorId: string;
  }) {
    if (input.rooms.length === 0) throw new BadRequestException('Select at least one room');

    const existing = await this.prisma.booking.findMany({
      where: { reservationGroupId: input.reservationGroupId, hotelId: input.hotelId },
      include: { payments: true, assignedRoom: true },
    });
    if (existing.length === 0) throw new NotFoundException('Reservation not found');
    if (existing.some((b) => b.status !== BookingStatus.confirmed)) {
      throw new ConflictException('Only an upcoming reservation (not yet checked in) can be edited this way');
    }

    const defaultNights = Math.round((input.checkOut.getTime() - input.checkIn.getTime()) / 86400000);
    if (defaultNights < 1) throw new BadRequestException('Check-out must be after check-in');

    const roomStays = input.rooms.map((r) => {
      const effCheckIn = r.checkIn ?? input.checkIn;
      const effCheckOut = r.checkOut ?? input.checkOut;
      const effNights = Math.round((effCheckOut.getTime() - effCheckIn.getTime()) / 86400000);
      if (effNights < 1) throw new BadRequestException('Check-out must be after check-in for every room');
      return { ...r, checkIn: effCheckIn, checkOut: effCheckOut, nights: effNights };
    });

    const roomIds = roomStays.map((r) => r.roomId);
    const rooms = await this.prisma.room.findMany({ where: { id: { in: roomIds }, hotelId: input.hotelId } });
    if (rooms.length !== roomIds.length) throw new NotFoundException('One or more selected rooms were not found');

    const existingByRoomId = new Map(existing.filter((b) => b.assignedRoomId).map((b) => [b.assignedRoomId!, b]));
    const submittedRoomIds = new Set(roomStays.map((r) => r.roomId));
    const toRemove = existing.filter((b) => b.assignedRoomId && !submittedRoomIds.has(b.assignedRoomId));
    const blockedRemoval = toRemove.find((b) => b.payments.length > 0);
    if (blockedRemoval) {
      throw new ConflictException(
        `Room ${blockedRemoval.assignedRoom?.roomNumber} has a payment recorded against it — remove the payment first, or keep this room in the reservation`,
      );
    }

    // Excludes this same reservation's own current rows — re-saving the same room/dates
    // shouldn't read as a conflict with itself.
    const existingIds = existing.map((b) => b.id);
    for (const stay of roomStays) {
      const overlapping = await this.prisma.booking.findFirst({
        where: {
          hotelId: input.hotelId,
          assignedRoomId: stay.roomId,
          id: { notIn: existingIds },
          status: { in: [BookingStatus.confirmed, BookingStatus.checked_in] },
          checkIn: { lt: stay.checkOut },
          checkOut: { gt: stay.checkIn },
        },
        include: { assignedRoom: true },
      });
      if (overlapping) {
        throw new ConflictException(`Room ${overlapping.assignedRoom?.roomNumber} already has a reservation for these dates`);
      }
    }

    const availabilityDeltas: { roomCategoryId: string; checkIn: Date; checkOut: Date; delta: number }[] = [];

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = [];
      for (const r of roomStays) {
        const room = rooms.find((room) => room.id === r.roomId)!;
        const prior = existingByRoomId.get(r.roomId);
        const shared = {
          guestName: input.guestName,
          bookedByName: input.rooms.length > 1 ? input.guestName : undefined,
          bookedByPhone: input.rooms.length > 1 ? input.guestPhone : undefined,
          guestPhone: input.guestPhone,
          guestEmail: input.guestEmail,
          specialRequest: input.specialRequest,
          ratePlanId: r.ratePlanId,
          checkIn: r.checkIn,
          checkOut: r.checkOut,
          nights: r.nights,
          totalAmount: r.totalAmount,
          discountAmount: r.discountAmount,
          gstExempt: r.gstExempt ?? false,
          source: input.source,
          billToCompanyName: input.companyName,
          billToCompanyTaxIdType: input.companyName ? input.companyTaxIdType : undefined,
          billToCompanyGstin: input.companyName ? input.companyGstin : undefined,
          billToCompanyPhone: input.companyName ? input.companyPhone : undefined,
          billToCompanyEmail: input.companyName ? input.companyEmail : undefined,
          billToCompanyAddress: input.companyName ? input.companyAddress : undefined,
          billToCompanyCountry: input.companyName ? input.companyCountry : undefined,
          billToCompanyState: input.companyName ? input.companyState : undefined,
          billToCompanyCity: input.companyName ? input.companyCity : undefined,
          billToCompanyPincode: input.companyName ? input.companyPincode : undefined,
        };
        let booking;
        if (prior) {
          if (prior.checkIn.getTime() !== r.checkIn.getTime() || prior.checkOut.getTime() !== r.checkOut.getTime() || prior.roomCategoryId !== room.roomCategoryId) {
            availabilityDeltas.push({ roomCategoryId: prior.roomCategoryId, checkIn: prior.checkIn, checkOut: prior.checkOut, delta: 1 });
            availabilityDeltas.push({ roomCategoryId: room.roomCategoryId!, checkIn: r.checkIn, checkOut: r.checkOut, delta: -1 });
          }
          booking = await tx.booking.update({ where: { id: prior.id }, data: { ...shared, roomCategoryId: room.roomCategoryId!, assignedRoomId: room.id } });
          await tx.invoiceLineItem.deleteMany({ where: { bookingId: booking.id } });
        } else {
          availabilityDeltas.push({ roomCategoryId: room.roomCategoryId!, checkIn: r.checkIn, checkOut: r.checkOut, delta: -1 });
          booking = await tx.booking.create({
            data: { ...shared, hotelId: input.hotelId, reservationGroupId: input.reservationGroupId, roomCategoryId: room.roomCategoryId!, assignedRoomId: room.id, status: BookingStatus.confirmed },
          });
        }
        if (r.lineItems?.length) {
          await tx.invoiceLineItem.createMany({
            data: r.lineItems.map((li) => ({ bookingId: booking.id, description: li.description, quantity: li.quantity, unitPrice: li.unitPrice, amount: li.quantity * li.unitPrice })),
          });
        }
        result.push(booking);
      }
      for (const b of toRemove) {
        availabilityDeltas.push({ roomCategoryId: b.roomCategoryId, checkIn: b.checkIn, checkOut: b.checkOut, delta: 1 });
        await tx.invoiceLineItem.deleteMany({ where: { bookingId: b.id } });
        await tx.booking.delete({ where: { id: b.id } });
      }
      return result;
    });

    await Promise.all(
      availabilityDeltas.map((d) => this.rates.adjustAvailabilityForStay({ hotelId: input.hotelId, roomCategoryId: d.roomCategoryId, checkIn: d.checkIn, checkOut: d.checkOut, delta: d.delta })),
    );

    await this.audit.log({
      hotelId: input.hotelId,
      eventType: 'STAY_EDITED',
      actorId: input.actorId,
      subjectId: input.reservationGroupId,
      detail: { guestName: input.guestName, rooms: rooms.map((r) => r.roomNumber) },
    });

    return updated;
  }

  /**
   * §8.3 — guest standing at the desk right now, no prior reservation.
   * Idempotent against double-submit. lineItems/discountAmount/gstExempt
   * (added beyond MD spec) are created atomically with the booking, so the
   * whole check-in wizard — guest details, extra charges, discount — commits
   * as one unit only when the user finishes it, never partially from an
   * abandoned step 2.
   */
  async checkInWalkIn(
    input: CheckInGuestDetails & {
      hotelId: string;
      roomId: string;
      purposeOfStay?: string;
      ratePlanId?: string;
      checkIn: Date;
      checkOut: Date;
      nights: number;
      source?: BookingSource;
      totalAmount: number;
      lineItems?: { description: string; quantity: number; unitPrice: number }[];
      discountAmount?: number;
      gstExempt?: boolean;
      companyName?: string;
      companyTaxIdType?: string;
      companyGstin?: string;
      companyPhone?: string;
      companyEmail?: string;
      companyAddress?: string;
      companyCountry?: string;
      companyState?: string;
      companyCity?: string;
      companyPincode?: string;
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
    if (room.status === 'housekeeping') {
      throw new ConflictException(`Room ${room.roomNumber} is not available right now because cleaning has not been completed.`);
    }
    if (room.status !== 'available') throw new ConflictException(`Room ${room.roomNumber} is not available`);
    if (!room.roomCategoryId) throw new ConflictException('Room has no category assigned yet — sort it during onboarding first');
    // §user request — a room can be put out of service for a future date range (Calendar's own
    // "Add Maintenance Block") without ever touching its *current* status, since that status is
    // only ever "right now", not a calendar. This is the one place that actually stops a walk-in
    // landing in a room while its block is live.
    const activeMaintenanceBlock = await this.prisma.roomMaintenanceBlock.findFirst({
      where: { roomId: input.roomId, releasedAt: null, startAt: { lt: input.checkOut }, endAt: { gt: input.checkIn } },
    });
    if (activeMaintenanceBlock) throw new ConflictException(`Room ${room.roomNumber} is under a maintenance block for this date`);

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
          discountAmount: input.discountAmount,
          gstExempt: input.gstExempt ?? false,
          status: BookingStatus.checked_in,
          checkedInAt: new Date(),
          source: input.source ?? 'walk_in',
          billToCompanyName: input.companyName,
          billToCompanyTaxIdType: input.companyName ? input.companyTaxIdType : undefined,
          billToCompanyGstin: input.companyName ? input.companyGstin : undefined,
          billToCompanyPhone: input.companyName ? input.companyPhone : undefined,
          billToCompanyEmail: input.companyName ? input.companyEmail : undefined,
          billToCompanyAddress: input.companyName ? input.companyAddress : undefined,
          billToCompanyCountry: input.companyName ? input.companyCountry : undefined,
          billToCompanyState: input.companyName ? input.companyState : undefined,
          billToCompanyCity: input.companyName ? input.companyCity : undefined,
          billToCompanyPincode: input.companyName ? input.companyPincode : undefined,
        },
      });
      if (input.lineItems?.length) {
        await tx.invoiceLineItem.createMany({
          data: input.lineItems.map((li) => ({
            bookingId: created.id,
            description: li.description,
            quantity: li.quantity,
            unitPrice: li.unitPrice,
            amount: li.quantity * li.unitPrice,
          })),
        });
      }
      // §bugfix — "room 103 mein 2 check-in kaise ho gaye": the room's `available` status was
      // only ever read once, well before this transaction (and even before linkGuestProfile's own
      // DB round-trip) — two check-ins for the same room landing close together could both read
      // `available`, both pass that check, and both end up creating a booking here. Claiming the
      // room with an atomic conditional update (status still 'available' right now, in this same
      // transaction) closes that window: Postgres row-locks the second writer behind the first,
      // and its WHERE no longer matches once the first commits, so `count` comes back 0 and this
      // whole transaction — including the booking row just created above — rolls back instead of
      // leaving two checked-in bookings on one physical room.
      const claimed = await tx.room.updateMany({
        where: { id: input.roomId, status: 'available' },
        data: { status: 'occupied', currentStayId: created.id, statusChangedAt: new Date() },
      });
      if (claimed.count === 0) {
        throw new ConflictException(`Room ${room.roomNumber} was just taken by another check-in — pick a different room`);
      }
      return created;
    });

    await this.audit.log({ hotelId: input.hotelId, eventType: 'CHECK_IN', actorId: input.actorId, subjectId: booking.id });
    await this.rates.adjustAvailabilityForStay({
      hotelId: input.hotelId,
      roomCategoryId: booking.roomCategoryId,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      delta: -1,
    });
    return booking;
  }

  /**
   * §user request — the FMO/GM's own explicit "Check-out Guest" action. This is the ONLY
   * place a booking becomes checked_out; it hands the room to housekeeping as Dirty/Cleaning
   * Required (room.status = 'housekeeping') — the room does NOT become Available until a
   * Checkout Cleaning closes it out (cleaning.service.ts). currentStayId is deliberately left
   * set (not cleared) through this pending-cleanup window so the room board and cleaning flow
   * can still see which stay this cleanup belongs to; it's cleared when cleaning completes.
   */
  async checkOutGuest(input: { hotelId: string; bookingId: string; actorId: string }) {
    const booking = await this.prisma.booking.findUniqueOrThrow({ where: { id: input.bookingId } });
    if (booking.hotelId !== input.hotelId) throw new NotFoundException('Booking not found');
    if (booking.status === BookingStatus.checked_out) return booking; // idempotent
    if (booking.status !== BookingStatus.checked_in) throw new ConflictException(`Booking is ${booking.status}, cannot check out`);
    if (!booking.assignedRoomId) throw new ConflictException('Booking has no assigned room');

    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.booking.update({
        where: { id: booking.id },
        data: { status: BookingStatus.checked_out, checkedOutAt: now, checkedOutBy: input.actorId },
      });
      await tx.room.update({
        where: { id: booking.assignedRoomId! },
        data: { status: 'housekeeping', statusChangedAt: now },
      });
      return result;
    });

    await this.audit.log({ hotelId: input.hotelId, eventType: 'CHECK_OUT', actorId: input.actorId, subjectId: booking.id });
    return updated;
  }

  /**
   * §8.3 — an existing confirmed reservation (direct or OTA) arrives and is
   * assigned a physical room. A manual booking (§8.4) doesn't collect full
   * guest details at creation time (that's a phone/advance booking), so
   * they're captured here, at the moment the guest is physically present.
   */
  async checkInReservation(
    input: CheckInGuestDetails & {
      bookingId: string;
      roomId: string;
      purposeOfStay?: string;
      lineItems?: { description: string; quantity: number; unitPrice: number }[];
      discountAmount?: number;
      gstExempt?: boolean;
      // §user request — "guest ek din pehle aa jaata hai, dates adjust karne de check-in ke time
      // hi": reserved 24→26, actually walks in on the 23rd and needs to leave the 25th. Optional —
      // omitted, the booking keeps its originally-reserved dates/amount exactly as before.
      checkIn?: Date;
      checkOut?: Date;
      nights?: number;
      totalAmount?: number;
      companyName?: string;
      companyTaxIdType?: string;
      companyGstin?: string;
      companyPhone?: string;
      companyEmail?: string;
      companyAddress?: string;
      companyCountry?: string;
      companyState?: string;
      companyCity?: string;
      companyPincode?: string;
      actorId: string;
    },
  ) {
    const [booking, room] = await Promise.all([
      this.prisma.booking.findUniqueOrThrow({ where: { id: input.bookingId } }),
      this.prisma.room.findUniqueOrThrow({ where: { id: input.roomId } }),
    ]);
    if (booking.status === BookingStatus.checked_in) return booking; // idempotent
    if (booking.status !== BookingStatus.confirmed) throw new ConflictException(`Booking is ${booking.status}, cannot check in`);
    if (!input.idNumber.trim()) throw new BadRequestException('Guest ID number is required at check-in');
    if (room.status === 'housekeeping') {
      throw new ConflictException(`Room ${room.roomNumber} is not available right now because cleaning has not been completed.`);
    }
    if (room.status !== 'available') throw new ConflictException(`Room ${room.roomNumber} is not available`);
    if (room.roomCategoryId !== booking.roomCategoryId) throw new ConflictException('Room category does not match the reservation');
    const effectiveCheckIn = input.checkIn ?? booking.checkIn;
    const effectiveCheckOut = input.checkOut ?? booking.checkOut;
    const activeMaintenanceBlock = await this.prisma.roomMaintenanceBlock.findFirst({
      where: { roomId: input.roomId, releasedAt: null, startAt: { lt: effectiveCheckOut }, endAt: { gt: effectiveCheckIn } },
    });
    if (activeMaintenanceBlock) throw new ConflictException(`Room ${room.roomNumber} is under a maintenance block for this date`);

    const datesChanged = Boolean(
      input.checkIn && input.checkOut && (input.checkIn.getTime() !== booking.checkIn.getTime() || input.checkOut.getTime() !== booking.checkOut.getTime()),
    );
    if (datesChanged && input.checkIn && input.checkOut) {
      if (input.checkOut <= input.checkIn) throw new BadRequestException('Check-out must be after check-in');
      const overlap = await this.prisma.booking.findFirst({
        where: {
          hotelId: booking.hotelId,
          assignedRoomId: input.roomId,
          id: { not: booking.id },
          status: { in: [BookingStatus.confirmed, BookingStatus.checked_in] },
          checkIn: { lt: input.checkOut },
          checkOut: { gt: input.checkIn },
        },
      });
      if (overlap) throw new ConflictException(`Room ${room.roomNumber} already has another reservation overlapping the adjusted dates`);
    }

    const guestId = await this.linkGuestProfile(booking.hotelId, input);

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.booking.update({
        where: { id: input.bookingId },
        data: {
          status: BookingStatus.checked_in,
          checkedInAt: new Date(),
          assignedRoomId: input.roomId,
          idType: input.idType,
          idNumber: input.idNumber,
          guestId,
          guestName: input.guestName || booking.guestName, // lets front desk correct a typo at check-in; required field, so this rarely falls back
          purposeOfStay: input.purposeOfStay,
          guestPhone: input.guestPhone ?? booking.guestPhone,
          discountAmount: input.discountAmount,
          gstExempt: input.gstExempt ?? booking.gstExempt,
          checkIn: input.checkIn ?? booking.checkIn,
          checkOut: input.checkOut ?? booking.checkOut,
          nights: input.nights ?? booking.nights,
          totalAmount: input.totalAmount ?? booking.totalAmount,
          // Undefined (not passed) leaves whatever was already set at reservation time untouched
          // — only an explicit companyName here overwrites it, same as every other optional field.
          billToCompanyName: input.companyName,
          billToCompanyTaxIdType: input.companyName ? input.companyTaxIdType : undefined,
          billToCompanyGstin: input.companyName ? input.companyGstin : undefined,
          billToCompanyPhone: input.companyName ? input.companyPhone : undefined,
          billToCompanyEmail: input.companyName ? input.companyEmail : undefined,
          billToCompanyAddress: input.companyName ? input.companyAddress : undefined,
          billToCompanyCountry: input.companyName ? input.companyCountry : undefined,
          billToCompanyState: input.companyName ? input.companyState : undefined,
          billToCompanyCity: input.companyName ? input.companyCity : undefined,
          billToCompanyPincode: input.companyName ? input.companyPincode : undefined,
        },
      });
      if (input.lineItems?.length) {
        await tx.invoiceLineItem.createMany({
          data: input.lineItems.map((li) => ({
            bookingId: result.id,
            description: li.description,
            quantity: li.quantity,
            unitPrice: li.unitPrice,
            amount: li.quantity * li.unitPrice,
          })),
        });
      }
      // §bugfix — same atomic-claim fix as checkInWalkIn: room.status was read well before this
      // transaction, so two near-simultaneous check-ins onto the same room could both pass that
      // earlier check. This conditional update is the real, race-free guard.
      const claimed = await tx.room.updateMany({
        where: { id: input.roomId, status: 'available' },
        data: { status: 'occupied', currentStayId: result.id, statusChangedAt: new Date() },
      });
      if (claimed.count === 0) {
        throw new ConflictException(`Room ${room.roomNumber} was just taken by another check-in — pick a different room`);
      }
      return result;
    });

    // The reservation's original dates already hold the pooled OTA availability (held at
    // creation time) — if the front desk just adjusted them above, release what was held for
    // the old range and consume what's actually needed for the new one, so the pool (and
    // whatever's pushed to connected channels) matches the room's real occupancy, not the
    // original booking.
    if (datesChanged) {
      await this.rates.adjustAvailabilityForStay({
        hotelId: booking.hotelId,
        roomCategoryId: booking.roomCategoryId,
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
        delta: 1,
      });
      await this.rates.adjustAvailabilityForStay({
        hotelId: booking.hotelId,
        roomCategoryId: booking.roomCategoryId,
        checkIn: updated.checkIn,
        checkOut: updated.checkOut,
        delta: -1,
      });
    }

    await this.audit.log({
      hotelId: booking.hotelId,
      eventType: 'CHECK_IN',
      actorId: input.actorId,
      subjectId: booking.id,
      detail: datesChanged ? { datesAdjustedFrom: { checkIn: booking.checkIn, checkOut: booking.checkOut } } : undefined,
    });
    return updated;
  }

  /**
   * §user request — "Neeraj ji ki booking mein rooms ko edit bhi kar sakte hain": swap which
   * physical room a still-confirmed (not yet checked-in) reservation is assigned to. Unlike
   * updateBooking (checked_in-only, 1-hour window), this is for *before* check-in — a reservation
   * sitting on "Upcoming" has no such window to respect, just an ordinary availability check.
   */
  async reassignReservationRoom(input: { bookingId: string; roomId: string; actorId: string }) {
    const booking = await this.prisma.booking.findUniqueOrThrow({ where: { id: input.bookingId } });
    if (booking.status !== BookingStatus.confirmed) {
      throw new ConflictException(`Booking is ${booking.status}, not an upcoming reservation — nothing to reassign`);
    }
    if (booking.assignedRoomId === input.roomId) return booking; // no-op

    const room = await this.prisma.room.findUniqueOrThrow({ where: { id: input.roomId } });
    if (room.hotelId !== booking.hotelId) throw new NotFoundException('Room not found at this hotel');
    if (room.roomCategoryId !== booking.roomCategoryId) throw new ConflictException('The new room is not in the same category as this booking');

    const overlap = await this.prisma.booking.findFirst({
      where: {
        hotelId: booking.hotelId,
        assignedRoomId: input.roomId,
        id: { not: booking.id },
        status: { in: [BookingStatus.confirmed, BookingStatus.checked_in] },
        checkIn: { lt: booking.checkOut },
        checkOut: { gt: booking.checkIn },
      },
    });
    if (overlap) throw new ConflictException(`Room ${room.roomNumber} already has another reservation overlapping these dates`);

    const updated = await this.prisma.booking.update({ where: { id: input.bookingId }, data: { assignedRoomId: input.roomId } });
    await this.audit.log({
      hotelId: booking.hotelId,
      eventType: 'ROOM_CHANGED',
      actorId: input.actorId,
      subjectId: booking.id,
      detail: { fromRoomId: booking.assignedRoomId, toRoomId: input.roomId },
    });
    return updated;
  }

  /**
   * §user request, reference app's own check-in flow — "+ Add Room": a group reservation
   * (Neeraj ji's 5 rooms) grows by one more room, as its own new Booking row sharing the same
   * reservationGroupId/booker/dates — same shape createMultiRoomReservation produces, just added
   * after the fact instead of all at once. Scoped to before that new room's own check-in (it's
   * born `confirmed`); existing rooms in the group are untouched regardless of their own status.
   */
  async addRoomToReservation(input: {
    reservationGroupId: string;
    roomId: string;
    ratePlanId?: string;
    totalAmount: number;
    actorId: string;
  }) {
    const groupBooking = await this.prisma.booking.findFirstOrThrow({
      where: { reservationGroupId: input.reservationGroupId },
      orderBy: { createdAt: 'asc' },
    });
    const room = await this.prisma.room.findUniqueOrThrow({ where: { id: input.roomId } });
    if (room.hotelId !== groupBooking.hotelId) throw new NotFoundException('Room not found at this hotel');

    const overlap = await this.prisma.booking.findFirst({
      where: {
        hotelId: groupBooking.hotelId,
        assignedRoomId: input.roomId,
        status: { in: [BookingStatus.confirmed, BookingStatus.checked_in] },
        checkIn: { lt: groupBooking.checkOut },
        checkOut: { gt: groupBooking.checkIn },
      },
    });
    if (overlap) throw new ConflictException(`Room ${room.roomNumber} already has a reservation for these dates`);

    const bookerName = groupBooking.bookedByName ?? groupBooking.guestName;
    const created = await this.prisma.booking.create({
      data: {
        hotelId: groupBooking.hotelId,
        reservationGroupId: groupBooking.reservationGroupId,
        guestName: bookerName,
        bookedByName: bookerName,
        bookedByPhone: groupBooking.bookedByPhone ?? groupBooking.guestPhone,
        guestPhone: groupBooking.guestPhone,
        guestEmail: groupBooking.guestEmail,
        specialRequest: groupBooking.specialRequest,
        roomCategoryId: room.roomCategoryId!,
        assignedRoomId: room.id,
        ratePlanId: input.ratePlanId,
        checkIn: groupBooking.checkIn,
        checkOut: groupBooking.checkOut,
        nights: groupBooking.nights,
        totalAmount: input.totalAmount,
        status: BookingStatus.confirmed,
        source: groupBooking.source,
      },
    });
    await this.rates.adjustAvailabilityForStay({
      hotelId: groupBooking.hotelId,
      roomCategoryId: room.roomCategoryId!,
      checkIn: groupBooking.checkIn,
      checkOut: groupBooking.checkOut,
      delta: -1,
    });
    await this.audit.log({
      hotelId: groupBooking.hotelId,
      eventType: 'RESERVATION_CREATED',
      actorId: input.actorId,
      subjectId: input.reservationGroupId,
      detail: { roomAdded: room.roomNumber },
    });
    return created;
  }

  /**
   * §5.2 / §8.5 — never alters room or booking status; that's the whole point.
   * Refuses to collect more than the outstanding balance.
   */
  async addPayment(input: {
    bookingId: string;
    amount: number;
    method: PaymentMethod;
    referenceNumber?: string;
    receiptPhotoPath?: string;
    collectedAt?: Date;
    collectedBy: string;
  }) {
    if (input.amount <= 0) throw new BadRequestException('Amount must be positive');

    return this.prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findUniqueOrThrow({ where: { id: input.bookingId }, include: { lineItems: true } });
      const alreadyPaid = Number(booking.paidAmount ?? 0);
      const { grandTotal } = computeInvoiceTotals({
        totalAmount: Number(booking.totalAmount),
        lineItems: booking.lineItems.map((li) => ({ ...li, unitPrice: Number(li.unitPrice), amount: Number(li.amount) })),
        discountAmount: booking.discountAmount ? Number(booking.discountAmount) : null,
        gstExempt: booking.gstExempt,
      });
      const outstanding = grandTotal - alreadyPaid;
      if (input.amount > outstanding + 0.01) {
        throw new ConflictException(`Cannot collect more than the outstanding balance (₹${outstanding.toFixed(2)})`);
      }

      const payment = await tx.payment.create({
        data: {
          bookingId: input.bookingId,
          amount: input.amount,
          method: input.method,
          referenceNumber: input.referenceNumber,
          receiptPhotoPath: input.receiptPhotoPath,
          collectedAt: input.collectedAt,
          collectedBy: input.collectedBy,
        },
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

  /**
   * §user request — "Neeraj ji room-wise payment nahi karte, ek hi baar mein poori booking ka
   * karte hain": a group reservation's booker pays against the WHOLE booking (e.g. ₹10,000
   * advance now, ₹10,000 at checkout), never room-by-room amounts picked by staff. The ledger
   * underneath still has to stay per-room (Payment is a per-Booking record, and per-room due/
   * revenue reporting depends on that) — so one entered amount is split across this group's rooms
   * proportional to each room's own outstanding due, and capped so a group payment can never
   * overpay the group's total due, same rule addPayment already enforces per room.
   */
  async addGroupPayment(input: {
    reservationGroupId: string;
    amount: number;
    method: PaymentMethod;
    referenceNumber?: string;
    collectedBy: string;
  }) {
    if (input.amount <= 0) throw new BadRequestException('Amount must be positive');

    return this.prisma.$transaction(async (tx) => {
      const bookings = await tx.booking.findMany({
        where: { reservationGroupId: input.reservationGroupId, status: { in: [BookingStatus.confirmed, BookingStatus.checked_in, BookingStatus.checked_out] } },
        include: { lineItems: true },
        orderBy: { createdAt: 'asc' },
      });
      if (bookings.length === 0) throw new NotFoundException('No active rooms found for this reservation');

      const dues = bookings.map((b) => {
        const { grandTotal } = computeInvoiceTotals({
          totalAmount: Number(b.totalAmount),
          lineItems: b.lineItems.map((li) => ({ ...li, unitPrice: Number(li.unitPrice), amount: Number(li.amount) })),
          discountAmount: b.discountAmount ? Number(b.discountAmount) : null,
          gstExempt: b.gstExempt,
        });
        return { booking: b, due: Math.max(0, grandTotal - Number(b.paidAmount ?? 0)) };
      });
      const totalDue = dues.reduce((sum, d) => sum + d.due, 0);
      if (input.amount > totalDue + 0.01) {
        throw new ConflictException(`Cannot collect more than this reservation's outstanding balance (₹${totalDue.toFixed(2)})`);
      }

      // Proportional split by each room's own due, with the running remainder folded into the
      // last room that actually owes anything — so the full entered amount always lands exactly,
      // never short or over by a rounding paisa.
      const owing = dues.filter((d) => d.due > 0);
      let remaining = input.amount;
      const payments = [];
      for (let i = 0; i < owing.length; i++) {
        const { booking, due } = owing[i];
        const isLast = i === owing.length - 1;
        const share = isLast ? Math.min(remaining, due) : Math.min(due, Math.round((due / totalDue) * input.amount * 100) / 100);
        if (share <= 0) continue;
        remaining -= share;

        const payment = await tx.payment.create({
          data: { bookingId: booking.id, amount: share, method: input.method, referenceNumber: input.referenceNumber, collectedBy: input.collectedBy },
        });
        await tx.booking.update({
          where: { id: booking.id },
          data: { paidAmount: Number(booking.paidAmount ?? 0) + share, paymentMethod: booking.paymentMethod ?? input.method },
        });
        await this.audit.log({
          hotelId: booking.hotelId,
          eventType: 'PAYMENT_RECEIVED',
          actorId: input.collectedBy,
          subjectId: booking.id,
          detail: { amount: share, method: input.method, groupPayment: true },
        });
        payments.push(payment);
      }
      return payments;
    });
  }

  /** "Add Extra Charges" on the invoice (§ added beyond MD spec). */
  async addLineItem(input: { bookingId: string; description: string; quantity: number; unitPrice: number; actorId: string }) {
    const amount = input.quantity * input.unitPrice;
    const item = await this.prisma.invoiceLineItem.create({
      data: { bookingId: input.bookingId, description: input.description, quantity: input.quantity, unitPrice: input.unitPrice, amount },
    });
    const booking = await this.prisma.booking.findUniqueOrThrow({ where: { id: input.bookingId } });
    await this.audit.log({ hotelId: booking.hotelId, eventType: 'STAY_EDITED', actorId: input.actorId, subjectId: booking.id, detail: { addedLineItem: input.description } });
    return item;
  }

  async removeLineItem(input: { lineItemId: string; actorId: string }) {
    const item = await this.prisma.invoiceLineItem.delete({ where: { id: input.lineItemId }, include: { booking: true } });
    await this.audit.log({ hotelId: item.booking.hotelId, eventType: 'STAY_EDITED', actorId: input.actorId, subjectId: item.bookingId, detail: { removedLineItem: item.description } });
    return item;
  }

  async listLineItems(bookingId: string) {
    return this.prisma.invoiceLineItem.findMany({ where: { bookingId }, orderBy: { createdAt: 'asc' } });
  }

  /** GST-exempt toggle + flat discount — owner/manager only, applies to the whole stay's invoice. */
  async setInvoiceSettings(input: { bookingId: string; discountAmount?: number | null; gstExempt?: boolean; actorId: string }) {
    const booking = await this.prisma.booking.update({
      where: { id: input.bookingId },
      data: { discountAmount: input.discountAmount, gstExempt: input.gstExempt },
    });
    await this.audit.log({ hotelId: booking.hotelId, eventType: 'STAY_EDITED', actorId: input.actorId, subjectId: booking.id, detail: { discountAmount: input.discountAmount, gstExempt: input.gstExempt } });
    return booking;
  }

  /**
   * §user request — "GST ya company ki naam se bill banana ho toh company info daal ke bane":
   * switches the invoice's "Billed to" from the individual guest to a company (for their GST
   * input credit) — set right from the invoice print view, any time, any booking status. Passing
   * `companyName: null` clears it back to billing the guest (not a 1-hour edit-window action like
   * check-in corrections — this is just which name prints, not the stay/amount itself).
   */
  async setCompanyBilling(input: {
    bookingId: string;
    companyName: string | null;
    companyGstin?: string | null;
    companyAddress?: string | null;
    actorId: string;
  }) {
    const booking = await this.prisma.booking.update({
      where: { id: input.bookingId },
      data: {
        billToCompanyName: input.companyName,
        billToCompanyGstin: input.companyName ? input.companyGstin : null,
        billToCompanyAddress: input.companyName ? input.companyAddress : null,
      },
    });
    await this.audit.log({
      hotelId: booking.hotelId,
      eventType: 'STAY_EDITED',
      actorId: input.actorId,
      subjectId: booking.id,
      detail: { billToCompanyName: input.companyName },
    });
    return booking;
  }

  /** Shared by every "correct a recent check-in mistake" action below. */
  private assertWithinEditWindow(booking: { status: BookingStatus; checkedInAt: Date | null }) {
    if (booking.status !== BookingStatus.checked_in) {
      throw new ConflictException(`Booking is ${booking.status}, not checked in — nothing to edit`);
    }
    if (!booking.checkedInAt || Date.now() - booking.checkedInAt.getTime() > BOOKING_EDIT_WINDOW_MS) {
      throw new ConflictException('The 1-hour post-check-in edit window has closed');
    }
  }

  /**
   * Correcting a recent check-in mistake — guest details, stay dates/amount,
   * room assignment, invoice line items, discount/GST — all in one shot, only
   * within the 1-hour window (§ added beyond MD spec, user request). Payments
   * are handled separately (addPayment/deletePayment) since they're an
   * append-only ledger, not a field on the booking itself.
   */
  async updateBooking(input: {
    bookingId: string;
    guestId?: string;
    title?: string;
    guestName?: string;
    guestPhone?: string;
    email?: string;
    gender?: Gender;
    dateOfBirth?: Date;
    address?: string;
    country?: string;
    state?: string;
    city?: string;
    pincode?: string;
    idType?: IdType;
    idNumber?: string;
    purposeOfStay?: string;
    roomId?: string;
    checkIn?: Date;
    checkOut?: Date;
    nights?: number;
    totalAmount?: number;
    lineItems?: { description: string; quantity: number; unitPrice: number }[];
    discountAmount?: number | null;
    gstExempt?: boolean;
    actorId: string;
  }) {
    const booking = await this.prisma.booking.findUniqueOrThrow({ where: { id: input.bookingId } });
    this.assertWithinEditWindow(booking);

    if (input.guestPhone && !/^\d{10}$/.test(input.guestPhone)) {
      throw new BadRequestException('Guest phone must be exactly 10 digits or blank');
    }
    if (input.nights !== undefined && input.nights < 1) throw new BadRequestException('Nights must be at least 1');
    if (input.idNumber !== undefined && !input.idNumber.trim()) throw new BadRequestException('Guest ID number is required');

    const guestId =
      input.guestPhone || input.guestId
        ? await this.linkGuestProfile(booking.hotelId, {
            guestId: input.guestId ?? booking.guestId ?? undefined,
            title: input.title,
            guestName: input.guestName ?? booking.guestName,
            guestPhone: input.guestPhone,
            email: input.email,
            gender: input.gender,
            dateOfBirth: input.dateOfBirth,
            address: input.address,
            country: input.country,
            state: input.state,
            city: input.city,
            pincode: input.pincode,
            idType: input.idType ?? booking.idType ?? 'other',
            idNumber: input.idNumber ?? booking.idNumber ?? '',
            idPhotoPath: undefined,
          })
        : (booking.guestId ?? undefined);

    let newRoom: { id: string; roomCategoryId: string | null; status: string } | null = null;
    if (input.roomId && input.roomId !== booking.assignedRoomId) {
      const candidate = await this.prisma.room.findUniqueOrThrow({ where: { id: input.roomId } });
      if (candidate.roomCategoryId !== booking.roomCategoryId) {
        throw new ConflictException('The new room is not in the same category as this booking');
      }
      if (candidate.status !== 'available') {
        throw new ConflictException('The new room is not available');
      }
      newRoom = candidate;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.booking.update({
        where: { id: input.bookingId },
        data: {
          guestId,
          guestName: input.guestName,
          guestPhone: input.guestPhone,
          idType: input.idType,
          idNumber: input.idNumber,
          purposeOfStay: input.purposeOfStay,
          checkIn: input.checkIn,
          checkOut: input.checkOut,
          nights: input.nights,
          totalAmount: input.totalAmount,
          discountAmount: input.discountAmount,
          gstExempt: input.gstExempt,
          assignedRoomId: newRoom?.id,
        },
      });

      if (input.lineItems) {
        await tx.invoiceLineItem.deleteMany({ where: { bookingId: input.bookingId } });
        if (input.lineItems.length) {
          await tx.invoiceLineItem.createMany({
            data: input.lineItems.map((li) => ({
              bookingId: input.bookingId,
              description: li.description,
              quantity: li.quantity,
              unitPrice: li.unitPrice,
              amount: li.quantity * li.unitPrice,
            })),
          });
        }
      }

      if (newRoom) {
        const oldRoom = await tx.room.findFirst({ where: { currentStayId: booking.id } });
        if (oldRoom) await tx.room.update({ where: { id: oldRoom.id }, data: { status: 'available', currentStayId: null, statusChangedAt: new Date() } });
        // §bugfix — same atomic-claim pattern as check-in: newRoom.status was read before this
        // transaction, so a concurrent check-in/room-switch onto the same room could win the race.
        const claimed = await tx.room.updateMany({
          where: { id: newRoom.id, status: 'available' },
          data: { status: 'occupied', currentStayId: booking.id, statusChangedAt: new Date() },
        });
        if (claimed.count === 0) {
          throw new ConflictException('The new room was just taken — pick a different room');
        }
      }

      return result;
    });

    await this.audit.log({
      hotelId: booking.hotelId,
      eventType: newRoom ? 'ROOM_CHANGED' : 'STAY_EDITED',
      actorId: input.actorId,
      subjectId: booking.id,
      detail: { roomChanged: Boolean(newRoom) },
    });
    return updated;
  }

  /** Undoing a mis-entered payment, same 1-hour window as updateBooking. Recomputed from the remaining ledger, never a raw subtraction. */
  async deletePayment(input: { paymentId: string; actorId: string }) {
    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUniqueOrThrow({ where: { id: input.paymentId }, include: { booking: true } });
      this.assertWithinEditWindow(payment.booking);

      await tx.payment.delete({ where: { id: input.paymentId } });
      const remaining = await tx.payment.aggregate({ where: { bookingId: payment.bookingId }, _sum: { amount: true } });
      const updated = await tx.booking.update({
        where: { id: payment.bookingId },
        data: { paidAmount: remaining._sum.amount ?? 0 },
      });

      await this.audit.log({
        hotelId: payment.booking.hotelId,
        eventType: 'STAY_EDITED',
        actorId: input.actorId,
        subjectId: payment.bookingId,
        detail: { paymentDeleted: input.paymentId, amount: Number(payment.amount) },
      });
      return updated;
    });
  }

  /**
   * "Add another guest" — a co-occupant sharing this same room/stay, not a
   * separate booking (§ added beyond MD spec, user request). Available for
   * the whole stay, not just the 1-hour edit window — a companion arriving
   * hours later is a normal front-desk operation, not a mistake to correct.
   */
  async addBookingGuest(input: { bookingId: string; title?: string; name: string; phone?: string; idType?: IdType; idNumber?: string; actorId: string }) {
    const booking = await this.prisma.booking.findUniqueOrThrow({ where: { id: input.bookingId } });
    if (booking.status !== BookingStatus.checked_in) throw new ConflictException(`Booking is ${booking.status}, not checked in`);

    const guest = await this.prisma.bookingGuest.create({
      data: {
        bookingId: input.bookingId,
        title: input.title,
        name: input.name,
        phone: input.phone,
        idType: input.idType,
        idNumber: input.idNumber,
      },
    });
    await this.audit.log({ hotelId: booking.hotelId, eventType: 'STAY_EDITED', actorId: input.actorId, subjectId: booking.id, detail: { addedGuest: input.name } });
    return guest;
  }

  async listBookingGuests(bookingId: string) {
    return this.prisma.bookingGuest.findMany({ where: { bookingId }, orderBy: { createdAt: 'asc' } });
  }

  async removeBookingGuest(input: { id: string; actorId: string }) {
    const guest = await this.prisma.bookingGuest.delete({ where: { id: input.id }, include: { booking: true } });
    await this.audit.log({ hotelId: guest.booking.hotelId, eventType: 'STAY_EDITED', actorId: input.actorId, subjectId: guest.bookingId, detail: { removedGuest: guest.name } });
    return guest;
  }

  /** The invoice as a whole — line items + computed totals, for the check-in wizard's step 2 and any future invoice view. */
  async getInvoice(bookingId: string) {
    const booking = await this.prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { lineItems: true, payments: true } });
    const totals = computeInvoiceTotals({
      totalAmount: Number(booking.totalAmount),
      lineItems: booking.lineItems.map((li) => ({ ...li, unitPrice: Number(li.unitPrice), amount: Number(li.amount) })),
      discountAmount: booking.discountAmount ? Number(booking.discountAmount) : null,
      gstExempt: booking.gstExempt,
    });
    return { booking, lineItems: booking.lineItems, totals };
  }

  /** §7 Phase 1 #5 — list + calendar of bookings pulled from every connected channel; otaConnectionId filters to one. */
  async listReservations(input: { hotelId: string; from?: Date; to?: Date; otaConnectionId?: string; overlapping?: boolean }) {
    return this.prisma.booking.findMany({
      where: {
        hotelId: input.hotelId,
        ...(input.overlapping
          ? // Stay-overlap, for Calendar's own grid — see the router's own comment on this flag.
            {
              ...(input.to ? { checkIn: { lt: input.to } } : {}),
              ...(input.from ? { checkOut: { gt: input.from } } : {}),
            }
          : input.from || input.to
            ? { checkIn: { gte: input.from ?? undefined, lte: input.to ?? undefined } }
            : {}),
        ...(input.otaConnectionId ? { otaConnectionId: input.otaConnectionId } : {}),
      },
      include: { payments: true, lineItems: true, guests: true },
      orderBy: { checkIn: 'asc' },
    });
  }

  /**
   * §7 Phase 1 #5's "one-time historical import" — no real OTA connectivity
   * exists yet (§ every adapter is a stub), so this is the interim path to get
   * a channel's existing reservations into the system: an owner pastes/uploads
   * rows exported from the OTA extranet. `status` defaults by date, same as a
   * human would classify these: past checkout date -> checked_out, else confirmed.
   */
  async importHistoricalBookings(input: {
    hotelId: string;
    otaConnectionId: string;
    source: BookingSource;
    rows: Array<{
      guestName: string;
      guestPhone?: string;
      roomCategoryId: string;
      checkIn: Date;
      checkOut: Date;
      nights: number;
      totalAmount: number;
      otaBookingRef?: string;
    }>;
  }) {
    const now = new Date();
    const created = await this.prisma.$transaction(
      input.rows.map((row) =>
        this.prisma.booking.create({
          data: {
            hotelId: input.hotelId,
            otaConnectionId: input.otaConnectionId,
            otaBookingRef: row.otaBookingRef,
            guestName: row.guestName,
            guestPhone: row.guestPhone,
            roomCategoryId: row.roomCategoryId,
            checkIn: row.checkIn,
            checkOut: row.checkOut,
            nights: row.nights,
            totalAmount: row.totalAmount,
            source: input.source,
            status: row.checkOut < now ? BookingStatus.checked_out : BookingStatus.confirmed,
          },
        }),
      ),
    );
    // Pooled inventory applies here too — a bulk-imported OTA booking blocks the same
    // room-night pool as any other booking source, same as createManualBooking/simulateInboundBooking.
    for (const row of input.rows) {
      await this.rates.adjustAvailabilityForStay({
        hotelId: input.hotelId,
        roomCategoryId: row.roomCategoryId,
        checkIn: row.checkIn,
        checkOut: row.checkOut,
        delta: -1,
      });
    }
    return { imported: created.length };
  }

  /**
   * Demo/dev-only stand-in for a real OTA webhook (§7 Phase 1 #11's "instant
   * booking notification") — no real channel connectivity exists to receive
   * one from, so this lets a hotel see/test the notification path today.
   * Swap for a real inbound webhook handler once an adapter is real.
   */
  async simulateInboundBooking(input: {
    hotelId: string;
    otaConnectionId: string;
    source: BookingSource;
    guestName: string;
    roomCategoryId: string;
    checkIn: Date;
    checkOut: Date;
    nights: number;
    totalAmount: number;
  }) {
    const booking = await this.prisma.booking.create({
      data: {
        hotelId: input.hotelId,
        otaConnectionId: input.otaConnectionId,
        guestName: input.guestName,
        roomCategoryId: input.roomCategoryId,
        checkIn: input.checkIn,
        checkOut: input.checkOut,
        nights: input.nights,
        totalAmount: input.totalAmount,
        source: input.source,
        status: BookingStatus.confirmed,
      },
    });
    await this.notifications.create({
      hotelId: input.hotelId,
      type: 'booking_created',
      title: `New booking — ${input.source}`,
      body: `${input.guestName}, ${dateLabel(input.checkIn)} → ${dateLabel(input.checkOut)}`,
      link: 'bookings',
    });
    await this.rates.adjustAvailabilityForStay({
      hotelId: input.hotelId,
      roomCategoryId: input.roomCategoryId,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      delta: -1,
    });
    return booking;
  }

  /** Cancels a not-yet-arrived reservation (direct or channel-sourced) — checked-in/out stays are a different action entirely. */
  async cancelBooking(input: { bookingId: string; actorId: string }) {
    const booking = await this.prisma.booking.findUniqueOrThrow({ where: { id: input.bookingId } });
    if (booking.status !== BookingStatus.confirmed) {
      throw new ConflictException('Only a confirmed (not yet arrived) reservation can be cancelled');
    }
    const updated = await this.prisma.booking.update({ where: { id: input.bookingId }, data: { status: BookingStatus.cancelled } });
    await this.notifications.create({
      hotelId: booking.hotelId,
      type: 'booking_cancelled',
      title: `Booking cancelled — ${booking.source}`,
      body: `${booking.guestName}, ${dateLabel(booking.checkIn)} → ${dateLabel(booking.checkOut)}`,
      link: 'bookings',
    });
    // Releases the room-nights this booking held back into the shared pool (mirror of the -1 applied when it was created).
    await this.rates.adjustAvailabilityForStay({
      hotelId: booking.hotelId,
      roomCategoryId: booking.roomCategoryId,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      delta: 1,
    });
    return updated;
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
    const rooms = await this.prisma.room.findMany({
      where: { hotelId, active: true },
      include: { roomCategory: true, currentStay: { include: { lineItems: true } } },
      orderBy: { roomNumber: 'asc' },
    });
    return rooms.map((r) => ({
      ...r,
      // Only a still-occupied room can be "delayed" (past its checkout deadline with the guest
      // still in it) — once the FMO has checked the guest out, the room's currentStay is already
      // closed and this no longer applies, even though currentStayId stays set during cleanup.
      delayed: r.status === 'occupied' && r.currentStay ? isDelayed(r.currentStay.checkIn, r.currentStay.checkOut, r.currentStay.delayResolvedAt) : false,
    }));
  }

  async getBooking(bookingId: string) {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId }, include: { payments: true, lineItems: true } });
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }

  /** In-House Guests — every currently-occupied room with its live stay, including derived Delayed state (§8.7). */
  async listInHouse(hotelId: string) {
    const rooms = await this.prisma.room.findMany({
      where: { hotelId, status: 'occupied', currentStayId: { not: null } },
      include: { roomCategory: true, currentStay: { include: { payments: true, lineItems: true } } },
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

  /**
   * Hotel-wide Dues — every booking (in-house, already checked out, or a
   * future reservation) with money still owed, computed via the same
   * computeInvoiceTotals grand-total logic as everywhere else (§ added
   * beyond MD spec, at the user's request — "the Due feature like Skymax").
   * Checked-out-with-a-balance is flagged as the most urgent case: the
   * guest has already left without settling.
   */
  async listDues(hotelId: string) {
    const bookings = await this.prisma.booking.findMany({
      where: { hotelId, status: { not: 'cancelled' } },
      include: { payments: true, lineItems: true, assignedRoom: true },
      orderBy: { checkIn: 'desc' },
    });

    return bookings
      .map((b) => {
        const totals = computeInvoiceTotals({
          totalAmount: Number(b.totalAmount),
          lineItems: b.lineItems.map((li) => ({ ...li, unitPrice: Number(li.unitPrice), amount: Number(li.amount) })),
          discountAmount: b.discountAmount ? Number(b.discountAmount) : null,
          gstExempt: b.gstExempt,
        });
        const due = totals.grandTotal - Number(b.paidAmount ?? 0);
        return { booking: b, roomNumber: b.assignedRoom?.roomNumber ?? null, grandTotal: totals.grandTotal, due };
      })
      .filter((r) => r.due > 0.01)
      .sort((a, b) => b.due - a.due);
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
