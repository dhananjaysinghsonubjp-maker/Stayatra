import { z } from 'zod';
import { authedProcedure, router } from '../trpc/trpc.js';
import type { NotificationsService } from './notifications.service.js';

export function createNotificationsRouter(notifications: NotificationsService) {
  return router({
    list: authedProcedure
      .input(z.object({ hotelId: z.string(), unreadOnly: z.boolean().optional(), limit: z.number().int().positive().max(100).optional() }))
      .query(({ input }) => notifications.list(input)),

    unreadCount: authedProcedure.input(z.object({ hotelId: z.string() })).query(({ input }) => notifications.unreadCount(input.hotelId)),

    markRead: authedProcedure.input(z.object({ id: z.string() })).mutation(({ input }) => notifications.markRead(input.id)),

    markAllRead: authedProcedure.input(z.object({ hotelId: z.string() })).mutation(({ input }) => notifications.markAllRead(input.hotelId)),
  });
}
