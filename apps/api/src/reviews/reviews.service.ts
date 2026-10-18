import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * OTA Reviews (§ user request) — "simulate first, wire up the real channel later," same
 * posture as Guest Messaging: no live OTA review-pull API exists yet, so an owner/manager
 * logs what they saw on that OTA's own extranet. `source` is always copied from the linked
 * booking rather than taken as separate input, so a review can never disagree with which
 * channel its own booking actually came from.
 */
@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async listReviews(hotelId: string) {
    return this.prisma.review.findMany({
      where: { hotelId },
      include: { booking: { select: { guestName: true, guestPhone: true, checkIn: true, checkOut: true, nights: true } } },
      orderBy: { reviewDate: 'desc' },
    });
  }

  /**
   * The denominator for "X reviews from Y bookings" (§ user request), broken down per channel
   * — so picking a channel can say "out of 15 MMT bookings, only 2 shared a review" instead of
   * just the hotel-wide total regardless of which channel is selected.
   */
  async countBookingsBySource(hotelId: string) {
    const rows = await this.prisma.booking.groupBy({ by: ['source'], where: { hotelId }, _count: { _all: true } });
    return Object.fromEntries(rows.map((r) => [r.source, r._count._all]));
  }

  /** Any booking, not just active ones — a review is almost always logged after the stay is long over. Most recently checked-out first. */
  async listReviewableBookings(hotelId: string) {
    return this.prisma.booking.findMany({
      where: { hotelId },
      select: { id: true, guestName: true, source: true, checkIn: true, checkOut: true, status: true },
      orderBy: { checkOut: 'desc' },
      take: 150,
    });
  }

  async createReview(input: {
    hotelId: string;
    bookingId: string;
    rating: number;
    maxRating: number;
    reviewText?: string;
    reviewDate: Date;
    actorId: string;
  }) {
    const booking = await this.prisma.booking.findFirstOrThrow({ where: { id: input.bookingId, hotelId: input.hotelId } });
    return this.prisma.review.create({
      data: {
        hotelId: input.hotelId,
        bookingId: input.bookingId,
        source: booking.source,
        rating: input.rating,
        maxRating: input.maxRating,
        reviewText: input.reviewText,
        reviewDate: input.reviewDate,
        createdBy: input.actorId,
      },
    });
  }
}
