import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ModuleType } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { customAlphabet } from 'nanoid';
import { PrismaService } from '../prisma/prisma.service.js';
import { PlansService } from '../plans/plans.service.js';

const SESSION_TOKEN_LENGTH = 48;
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days, same as the tenant-side session TTL

const generateToken = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', SESSION_TOKEN_LENGTH);

/**
 * Everything a platform operator does — sees and manages every tenant
 * organization, never scoped to one (§ added beyond MD spec, at user
 * request: "super admin panel where I can manage all users (hotels)").
 * Deliberately a separate service/session type from AuthService's tenant
 * users, not an extra role bolted onto them — see schema.prisma's
 * PlatformAdmin model comment for why.
 */
@Injectable()
export class PlatformAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: PlansService,
  ) {}

  async login(input: { email: string; password: string }) {
    const admin = await this.prisma.platformAdmin.findUnique({ where: { email: input.email } });
    if (!admin) throw new UnauthorizedException('Invalid email or password');
    const valid = await bcrypt.compare(input.password, admin.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid email or password');

    const token = generateToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await this.prisma.session.create({ data: { platformAdminId: admin.id, token, expiresAt } });
    return { token, platformAdminId: admin.id, name: admin.name, email: admin.email };
  }

  async resolveSession(token: string) {
    const session = await this.prisma.session.findUnique({
      where: { token },
      include: { platformAdmin: true },
    });
    if (!session || !session.platformAdmin || session.expiresAt < new Date()) return null;
    return { platformAdminId: session.platformAdmin.id, name: session.platformAdmin.name, email: session.platformAdmin.email };
  }

  /** Every tenant, with enough at-a-glance detail to manage them — hotel/staff counts, entitlements, suspension state. */
  async listOrganizations() {
    const orgs = await this.prisma.organization.findMany({
      include: {
        modules: true,
        hotels: { select: { id: true, name: true, shortCode: true } },
        users: { select: { id: true } },
        affiliate: { select: { id: true, name: true, brandName: true } },
        subscription: { include: { plan: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return orgs.map((o) => ({
      id: o.id,
      name: o.name,
      planTier: o.planTier,
      suspended: o.suspended,
      createdAt: o.createdAt,
      hotels: o.hotels,
      staffCount: o.users.length,
      modules: Object.fromEntries(o.modules.map((m) => [m.module, m.enabled])) as Record<ModuleType, boolean>,
      subscription: o.subscription ? { planName: o.subscription.plan.name, status: o.subscription.status } : null,
      affiliate: o.affiliate,
    }));
  }

  /** No self-registration for affiliates either — a platform admin creates every account (§8.2's pattern, applied here too). */
  async createAffiliate(input: {
    name: string;
    email: string;
    password: string;
    commissionRate?: number;
    brandName?: string;
    logoUrl?: string;
    primaryColor?: string;
  }) {
    const existing = await this.prisma.affiliate.findUnique({ where: { email: input.email } });
    if (existing) throw new ConflictException('An affiliate with this email already exists');
    const passwordHash = await bcrypt.hash(input.password, 12);
    return this.prisma.affiliate.create({
      data: {
        name: input.name,
        email: input.email,
        passwordHash,
        commissionRate: input.commissionRate,
        brandName: input.brandName,
        logoUrl: input.logoUrl,
        primaryColor: input.primaryColor,
      },
    });
  }

  async listAffiliates() {
    const affiliates = await this.prisma.affiliate.findMany({
      include: { organizations: { select: { id: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return affiliates.map(({ passwordHash, organizations, ...rest }) => ({ ...rest, referredCount: organizations.length }));
  }

  /** Assigning (or, with null, un-assigning) which reseller referred an existing organization. */
  async assignOrganizationToAffiliate(input: { organizationId: string; affiliateId: string | null }) {
    return this.prisma.organization.update({ where: { id: input.organizationId }, data: { referredByAffiliateId: input.affiliateId } });
  }

  /**
   * The hotel detail view — plan, address/overview, and headcounts by role.
   * "General Managers" maps to the `manager` role (the industry term for it);
   * front desk/housekeeping are PMS-only concepts, counted per distinct user
   * so someone with roles in two modules isn't double-counted.
   */
  async getOrganization(id: string) {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id },
      include: {
        modules: true,
        hotels: { include: { _count: { select: { rooms: true } } } },
        users: { include: { moduleRoles: true } },
        subscription: { include: { plan: true } },
        affiliate: { select: { id: true, name: true, brandName: true } },
      },
    });

    const hasRole = (role: string) => org.users.filter((u) => u.moduleRoles.some((r) => r.role === role)).length;

    return {
      ...org,
      modules: Object.fromEntries(org.modules.map((m) => [m.module, m.enabled])) as Record<ModuleType, boolean>,
      subscription: org.subscription ? { planId: org.subscription.planId, planName: org.subscription.plan.name, status: org.subscription.status } : null,
      roomCount: org.hotels.reduce((sum, h) => sum + h._count.rooms, 0),
      staffCounts: {
        owners: hasRole('owner'),
        generalManagers: hasRole('manager'),
        frontDesk: hasRole('front_desk'),
        housekeeping: hasRole('housekeeping'),
      },
    };
  }

  /** Reassigns the whole plan at once — resets every module to exactly what the new plan grants, not just toggling one at a time. */
  async changeOrganizationPlan(input: { organizationId: string; planKey: string }) {
    const plan = await this.plans.getPlanByKey(input.planKey);
    const allModules: ModuleType[] = ['channel_manager', 'pms', 'theft_protection'];

    await this.prisma.$transaction([
      ...allModules.map((module) =>
        this.prisma.organizationModule.upsert({
          where: { organizationId_module: { organizationId: input.organizationId, module } },
          create: { organizationId: input.organizationId, module, enabled: plan.modules.includes(module) },
          update: { enabled: plan.modules.includes(module) },
        }),
      ),
      this.prisma.subscription.upsert({
        where: { organizationId: input.organizationId },
        create: {
          organizationId: input.organizationId,
          planId: plan.id,
          status: 'active',
          currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
        },
        update: { planId: plan.id },
      }),
    ]);
    return this.getOrganization(input.organizationId);
  }

  /** Hotel details/address — editable from the detail view; room/staff counts are derived, not stored, so nothing to edit there directly. */
  async updateHotelDetails(input: {
    hotelId: string;
    name?: string;
    addressLine?: string;
    city?: string;
    state?: string;
    pincode?: string;
    gstRegistration?: string;
  }) {
    const { hotelId, ...data } = input;
    return this.prisma.hotel.update({ where: { id: hotelId }, data });
  }

  /** theft_protection can only be on if pms is also on for this org (§5.5) — enforced here, the one place entitlements are written. */
  async setModuleEnabled(input: { organizationId: string; module: ModuleType; enabled: boolean }) {
    if (input.module === 'theft_protection' && input.enabled) {
      const pms = await this.prisma.organizationModule.findUnique({
        where: { organizationId_module: { organizationId: input.organizationId, module: 'pms' } },
      });
      if (!pms?.enabled) throw new ConflictException('Enable PMS before enabling Theft Protection for this organization');
    }
    return this.prisma.organizationModule.upsert({
      where: { organizationId_module: { organizationId: input.organizationId, module: input.module } },
      create: { organizationId: input.organizationId, module: input.module, enabled: input.enabled },
      update: { enabled: input.enabled },
    });
  }

  /** The kill switch — blocks every login for every user in this org (checked in AuthService). */
  async setSuspended(input: { organizationId: string; suspended: boolean }) {
    return this.prisma.organization.update({ where: { id: input.organizationId }, data: { suspended: input.suspended } });
  }
}
