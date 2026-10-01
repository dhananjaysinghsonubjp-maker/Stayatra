import { z } from 'zod';
import { publicProcedure, platformAdminProcedure, router } from '../trpc/trpc.js';
import type { PlansService } from './plans.service.js';

export function createPlansRouter(plans: PlansService) {
  return router({
    list: publicProcedure.query(() => plans.listPlans()),

    updatePrice: platformAdminProcedure
      .input(z.object({ planId: z.string(), priceMonthly: z.number().nonnegative() }))
      .mutation(({ input }) => plans.updatePrice(input)),
  });
}
