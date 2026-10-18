import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class GuestMessagingService {
  constructor(private readonly prisma: PrismaService) {}

  /** One row per booking that has at least one message, newest conversation first. */
  async listThreads(hotelId: string) {
    const bookings = await this.prisma.booking.findMany({
      where: { hotelId, guestMessages: { some: {} } },
      select: {
        id: true,
        guestName: true,
        guestPhone: true,
        source: true,
        checkIn: true,
        checkOut: true,
        status: true,
        guestMessages: { orderBy: { createdAt: 'desc' }, take: 1 },
        _count: { select: { guestMessages: { where: { sender: 'guest', readByStaff: false } } } },
      },
    });

    return bookings
      .map((b) => ({
        bookingId: b.id,
        guestName: b.guestName,
        guestPhone: b.guestPhone,
        source: b.source,
        checkIn: b.checkIn,
        checkOut: b.checkOut,
        status: b.status,
        lastMessage: b.guestMessages[0] ?? null,
        unreadCount: b._count.guestMessages,
      }))
      .sort((a, b) => (b.lastMessage?.createdAt.getTime() ?? 0) - (a.lastMessage?.createdAt.getTime() ?? 0));
  }

  /** Active bookings with no conversation yet — the picker for starting a new thread. */
  async listMessageableBookings(hotelId: string) {
    return this.prisma.booking.findMany({
      where: { hotelId, status: { in: ['confirmed', 'checked_in'] }, guestMessages: { none: {} } },
      select: { id: true, guestName: true, guestPhone: true, source: true, checkIn: true, checkOut: true, status: true },
      orderBy: { checkIn: 'asc' },
    });
  }

  async getThread(hotelId: string, bookingId: string) {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, hotelId },
      select: { id: true, guestName: true, guestPhone: true, source: true, checkIn: true, checkOut: true, status: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    const messages = await this.prisma.guestMessage.findMany({ where: { hotelId, bookingId }, orderBy: { createdAt: 'asc' } });
    return { booking, messages };
  }

  async sendMessage(input: { hotelId: string; bookingId: string; sender: 'guest' | 'staff'; body: string }) {
    const booking = await this.prisma.booking.findFirst({ where: { id: input.bookingId, hotelId: input.hotelId } });
    if (!booking) throw new NotFoundException('Booking not found');
    return this.prisma.guestMessage.create({
      data: {
        hotelId: input.hotelId,
        bookingId: input.bookingId,
        sender: input.sender,
        body: input.body,
        // staff's own message is inherently already "read"; a logged guest message starts unread.
        readByStaff: input.sender === 'staff',
      },
    });
  }

  async markThreadRead(hotelId: string, bookingId: string) {
    await this.prisma.guestMessage.updateMany({ where: { hotelId, bookingId, sender: 'guest', readByStaff: false }, data: { readByStaff: true } });
    return { ok: true };
  }
}
