import { z } from 'zod';
import { publicProcedure, platformAdminProcedure, router } from '../trpc/trpc.js';
import type { PlatformAdminService } from './platform-admin.service.js';

const moduleTypeSchema = z.enum(['channel_manager', 'pms', 'theft_protection']);

export function createPlatformAdminRouter(platformAdmin: PlatformAdminService) {
  return router({
    login: publicProcedure
      .input(z.object({ email: z.string().email(), password: z.string().min(1) }))
      .mutation(({ input }) => platformAdmin.login(input)),

    me: platformAdminProcedure.query(({ ctx }) => ctx.platformAdmin),

    listOrganizations: platformAdminProcedure.query(() => platformAdmin.listOrganizations()),

    getOrganization: platformAdminProcedure.input(z.object({ organizationId: z.string() })).query(({ input }) => platformAdmin.getOrganization(input.organizationId)),

    setModuleEnabled: platformAdminProcedure
      .input(z.object({ organizationId: z.string(), module: moduleTypeSchema, enabled: z.boolean() }))
      .mutation(({ input }) => platformAdmin.setModuleEnabled(input)),

    setSuspended: platformAdminProcedure
      .input(z.object({ organizationId: z.string(), suspended: z.boolean() }))
      .mutation(({ input }) => platformAdmin.setSuspended(input)),

    createAffiliate: platformAdminProcedure
      .input(
        z.object({
          name: z.string().min(1),
          email: z.string().email(),
          password: z.string().min(8),
          commissionRate: z.number().min(0).max(100).optional(),
          brandName: z.string().optional(),
          logoUrl: z.string().optional(),
          primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
        }),
      )
      .mutation(({ input }) => platformAdmin.createAffiliate(input)),

    listAffiliates: platformAdminProcedure.query(() => platformAdmin.listAffiliates()),

    assignOrganizationToAffiliate: platformAdminProcedure
      .input(z.object({ organizationId: z.string(), affiliateId: z.string().nullable() }))
      .mutation(({ input }) => platformAdmin.assignOrganizationToAffiliate(input)),

    changeOrganizationPlan: platformAdminProcedure
      .input(z.object({ organizationId: z.string(), planKey: z.string() }))
      .mutation(({ input }) => platformAdmin.changeOrganizationPlan(input)),

    updateHotelDetails: platformAdminProcedure
      .input(
        z.object({
          hotelId: z.string(),
          name: z.string().min(1).optional(),
          addressLine: z.string().optional(),
          city: z.string().optional(),
          state: z.string().optional(),
          pincode: z.string().optional(),
          gstRegistration: z.string().optional(),
        }),
      )
      .mutation(({ input }) => platformAdmin.updateHotelDetails(input)),
  });
}
