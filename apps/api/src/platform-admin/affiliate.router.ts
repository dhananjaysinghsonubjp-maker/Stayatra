import { z } from 'zod';
import { publicProcedure, affiliateProcedure, router } from '../trpc/trpc.js';
import type { AffiliateService } from './affiliate.service.js';

const moduleTypeSchema = z.enum(['channel_manager', 'pms', 'theft_protection']);

export function createAffiliateRouter(affiliate: AffiliateService) {
  return router({
    login: publicProcedure
      .input(z.object({ email: z.string().email(), password: z.string().min(1) }))
      .mutation(({ input }) => affiliate.login(input)),

    me: affiliateProcedure.query(({ ctx }) => ctx.affiliate),

    listOrganizations: affiliateProcedure.query(({ ctx }) => affiliate.listOrganizations(ctx.affiliate.affiliateId)),

    setModuleEnabled: affiliateProcedure
      .input(z.object({ organizationId: z.string(), module: moduleTypeSchema, enabled: z.boolean() }))
      .mutation(({ ctx, input }) => affiliate.setModuleEnabled({ ...input, affiliateId: ctx.affiliate.affiliateId })),

    setSuspended: affiliateProcedure
      .input(z.object({ organizationId: z.string(), suspended: z.boolean() }))
      .mutation(({ ctx, input }) => affiliate.setSuspended({ ...input, affiliateId: ctx.affiliate.affiliateId })),
  });
}
