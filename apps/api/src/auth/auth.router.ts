import { z } from 'zod';
import { authedProcedure, publicProcedure, router, requireRole } from '../trpc/trpc.js';
import type { AuthService } from './auth.service.js';

export function createAuthRouter(auth: AuthService) {
  return router({
    me: authedProcedure.query(({ ctx }) => ctx.user),

    signup: publicProcedure
      .input(
        z.object({
          organizationName: z.string().min(1),
          ownerName: z.string().min(1),
          email: z.string().email(),
          password: z.string().min(8),
          planKey: z.string().min(1),
        }),
      )
      .mutation(({ input }) => auth.signup(input)),

    login: publicProcedure
      .input(z.object({ email: z.string().email(), password: z.string().min(1) }))
      .mutation(({ input }) => auth.login(input)),

    pinLogin: publicProcedure
      .input(z.object({ shortCode: z.string().min(1), pin: z.string().min(4).max(6), deviceId: z.string().min(1) }))
      .mutation(({ input }) => auth.pinLogin(input)),

    createStaffPin: requireRole('pms', ['owner', 'manager'])
      .input(
        z.object({
          hotelId: z.string(),
          name: z.string().min(1),
          role: z.enum(['front_desk', 'housekeeping']),
          pin: z.string().min(4).max(6),
        }),
      )
      .mutation(({ input }) => auth.createStaffPin(input)),
  });
}
