import { router, publicProcedure } from './trpc.js';

export const appRouter = router({
  health: router({
    check: publicProcedure.query(async ({ ctx }) => {
      await ctx.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', db: 'connected' };
    }),
  }),
});

export type AppRouter = typeof appRouter;
