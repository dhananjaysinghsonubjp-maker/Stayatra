import { ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ModuleType } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { customAlphabet } from 'nanoid';
import { PrismaService } from '../prisma/prisma.service.js';

const SESSION_TOKEN_LENGTH = 48;
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

const generateToken = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', SESSION_TOKEN_LENGTH);

/**
 * A reseller/white-label partner's own console — same shape as
 * PlatformAdminService, but every read/write here is scoped to
 * `referredByAffiliateId = this affiliate's id`. Never trust a client-supplied
 * organizationId without checking that ownership first (§4's rule applies to
 * every actor type, not just tenant users).
 */
@Injectable()
export class AffiliateService {
  constructor(private readonly prisma: PrismaService) {}

  async login(input: { email: string; password: string }) {
    const affiliate = await this.prisma.affiliate.findUnique({ where: { email: input.email } });
    if (!affiliate) throw new UnauthorizedException('Invalid email or password');
    const valid = await bcrypt.compare(input.password, affiliate.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid email or password');

    const token = generateToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await this.prisma.session.create({ data: { affiliateId: affiliate.id, token, expiresAt } });
    return {
      token,
      affiliateId: affiliate.id,
      name: affiliate.name,
      email: affiliate.email,
      brandName: affiliate.brandName,
      logoUrl: affiliate.logoUrl,
      primaryColor: affiliate.primaryColor,
    };
  }

  async resolveSession(token: string) {
    const session = await this.prisma.session.findUnique({ where: { token }, include: { affiliate: true } });
    if (!session || !session.affiliate || session.expiresAt < new Date()) return null;
    const a = session.affiliate;
    return { affiliateId: a.id, name: a.name, email: a.email, brandName: a.brandName, logoUrl: a.logoUrl, primaryColor: a.primaryColor };
  }

  /** Only this affiliate's referred organizations — never the whole platform. */
  async listOrganizations(affiliateId: string) {
    const orgs = await this.prisma.organization.findMany({
      where: { referredByAffiliateId: affiliateId },
      include: { modules: true, hotels: { select: { id: true, name: true, shortCode: true } }, users: { select: { id: true } } },
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
    }));
  }

  private async assertOwnsOrg(affiliateId: string, organizationId: string) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    if (org.referredByAffiliateId !== affiliateId) {
      throw new ForbiddenException('This organization was not referred by you');
    }
    return org;
  }

  async setModuleEnabled(input: { affiliateId: string; organizationId: string; module: ModuleType; enabled: boolean }) {
    await this.assertOwnsOrg(input.affiliateId, input.organizationId);
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

  async setSuspended(input: { affiliateId: string; organizationId: string; suspended: boolean }) {
    await this.assertOwnsOrg(input.affiliateId, input.organizationId);
    return this.prisma.organization.update({ where: { id: input.organizationId }, data: { suspended: input.suspended } });
  }
}
