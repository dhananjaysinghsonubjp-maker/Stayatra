import { z } from 'zod';
import { router, requireRole } from '../trpc/trpc.js';
import type { GuestMessagingService } from './guest-messaging.service.js';

const cmOwnerOrManager = requireRole('channel_manager', ['owner', 'manager']);

export function createGuestMessagingRouter(guestMessaging: GuestMessagingService) {
  return router({
    listThreads: cmOwnerOrManager.input(z.object({ hotelId: z.string() })).query(({ input }) => guestMessaging.listThreads(input.hotelId)),

    listMessageableBookings: cmOwnerOrManager
      .input(z.object({ hotelId: z.string() }))
      .query(({ input }) => guestMessaging.listMessageableBookings(input.hotelId)),

    getThread: cmOwnerOrManager
      .input(z.object({ hotelId: z.string(), bookingId: z.string() }))
      .query(({ input }) => guestMessaging.getThread(input.hotelId, input.bookingId)),

    send: cmOwnerOrManager
      .input(z.object({ hotelId: z.string(), bookingId: z.string(), sender: z.enum(['guest', 'staff']), body: z.string().min(1) }))
      .mutation(({ input }) => guestMessaging.sendMessage(input)),

    markRead: cmOwnerOrManager
      .input(z.object({ hotelId: z.string(), bookingId: z.string() }))
      .mutation(({ input }) => guestMessaging.markThreadRead(input.hotelId, input.bookingId)),
  });
}
