import { z } from 'zod';
import { requireRole } from '../trpc/trpc.js';
import { router } from '../trpc/trpc.js';
import type { GuestsService } from './guests.service.js';

const frontDeskUp = requireRole('pms', ['owner', 'manager', 'front_desk']);

export function createGuestsRouter(guests: GuestsService) {
  return router({
    search: frontDeskUp
      .input(z.object({ hotelId: z.string(), phone: z.string().min(3) }))
      .query(({ input }) => guests.search(input)),

    get: frontDeskUp.input(z.object({ id: z.string() })).query(({ input }) => guests.get(input.id)),
  });
}
