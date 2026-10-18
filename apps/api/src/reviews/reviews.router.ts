import { z } from 'zod';
import { router, requireRole } from '../trpc/trpc.js';
import type { ReviewsService } from './reviews.service.js';

const cmOwnerOrManager = requireRole('channel_manager', ['owner', 'manager']);

export function createReviewsRouter(reviews: ReviewsService) {
  return router({
    list: cmOwnerOrManager.input(z.object({ hotelId: z.string() })).query(({ input }) => reviews.listReviews(input.hotelId)),

    listReviewableBookings: cmOwnerOrManager
      .input(z.object({ hotelId: z.string() }))
      .query(({ input }) => reviews.listReviewableBookings(input.hotelId)),

    countBookingsBySource: cmOwnerOrManager
      .input(z.object({ hotelId: z.string() }))
      .query(({ input }) => reviews.countBookingsBySource(input.hotelId)),

    create: cmOwnerOrManager
      .input(
        z.object({
          hotelId: z.string(),
          bookingId: z.string(),
          rating: z.number().min(0).max(10),
          maxRating: z.number().int().min(1).max(10),
          reviewText: z.string().optional(),
          reviewDate: z.coerce.date(),
        }),
      )
      .mutation(({ ctx, input }) => reviews.createReview({ ...input, actorId: ctx.user.userId })),
  });
}
