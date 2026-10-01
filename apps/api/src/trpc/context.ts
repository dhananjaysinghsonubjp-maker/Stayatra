import type { CreateExpressContextOptions } from '@trpc/server/adapters/express';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuthService } from '../auth/auth.service.js';
import type { PlatformAdminService } from '../platform-admin/platform-admin.service.js';
import type { AffiliateService } from '../platform-admin/affiliate.service.js';
import type { AccessResult } from '../plans/subscription-status.js';

export interface ActingUser {
  userId: string;
  organizationId: string;
  hotelId: string | null;
  roles: Record<string, string>; // module -> role, e.g. { pms: 'front_desk' }
  /** §5.4's trial/grace/lock gate — computed fresh per request, see subscription-status.ts. */
  subscriptionAccess: AccessResult;
}

export interface ActingPlatformAdmin {
  platformAdminId: string;
  name: string;
  email: string;
}

export interface ActingAffiliate {
  affiliateId: string;
  name: string;
  email: string;
  brandName: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
}

export function createContextFactory(prisma: PrismaService, auth: AuthService, platformAdmin: PlatformAdminService, affiliate: AffiliateService) {
  return async function createContext({ req }: CreateExpressContextOptions) {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
    // A token belongs to exactly one of these three actor types, never more
    // than one — trying the tenant path first and falling back costs extra
    // lookups only for platform-admin/affiliate requests, which are rare.
    const user: ActingUser | null = token ? await auth.resolveSession(token) : null;
    const admin: ActingPlatformAdmin | null = token && !user ? await platformAdmin.resolveSession(token) : null;
    const aff: ActingAffiliate | null = token && !user && !admin ? await affiliate.resolveSession(token) : null;

    return { prisma, user, platformAdmin: admin, affiliate: aff };
  };
}

export type Context = Awaited<ReturnType<ReturnType<typeof createContextFactory>>>;
