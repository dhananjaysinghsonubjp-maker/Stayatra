import { Injectable, Logger } from '@nestjs/common';
import { ModuleType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { resolveSubscriptionAccess } from './subscription-status.js';

const BILLING_CYCLE_DAYS = 30; // matches auth.service.ts's signup constant — one paid period's length

/**
 * The 4 purchasable plans (§ beyond MD spec's 3-package table, at user request — PMS also sold
 * standalone, for a hotel that already runs its own channel manager elsewhere). No standalone
 * Theft Protection plan — §5.5's rule is that it depends on PMS's live room-board data and isn't
 * sellable alone, so it only ever appears bundled into the top tier, never as its own purchase.
 *
 * Prices are real numbers set by the user (not placeholders) — edit via
 * `platformAdmin.updatePlanPrice` if they ever change, no code change needed.
 */
const DEFAULT_PLANS: {
  key: string;
  name: string;
  description: string;
  modules: ModuleType[];
  priceMonthly: number;
}[] = [
  {
    key: 'channel_manager',
    name: 'Channel Manager',
    description: 'OTA distribution — rates, availability, and restrictions synced across every connected channel.',
    modules: ['channel_manager'],
    priceMonthly: 1200,
  },
  {
    key: 'pms',
    name: 'PMS',
    description: 'Day-to-day front-desk and housekeeping operations — check-in, room board, payments.',
    modules: ['pms'],
    priceMonthly: 1700,
  },
  {
    key: 'cm_pms',
    name: 'Channel Manager + PMS',
    description: 'One system for both OTA distribution and day-to-day front-desk/housekeeping operations.',
    modules: ['channel_manager', 'pms'],
    priceMonthly: 2500,
  },
  {
    key: 'cm_pms_theft',
    name: 'Channel Manager + PMS + Theft Protection',
    description: 'Everything — distribution, day-to-day operations, and revenue-leakage protection.',
    modules: ['channel_manager', 'pms', 'theft_protection'],
    priceMonthly: 4000,
  },
];

@Injectable()
export class PlansService {
  private readonly logger = new Logger(PlansService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Idempotent — safe to run on every boot. Only creates missing plans, never overwrites an edited price. */
  async seedDefaults() {
    for (const plan of DEFAULT_PLANS) {
      const existing = await this.prisma.subscriptionPlan.findUnique({ where: { key: plan.key } });
      if (!existing) {
        await this.prisma.subscriptionPlan.create({ data: plan });
        this.logger.log(`Seeded plan "${plan.name}"`);
      }
    }
  }

  async listPlans() {
    return this.prisma.subscriptionPlan.findMany({ orderBy: { priceMonthly: 'asc' } });
  }

  async getPlanByKey(key: string) {
    return this.prisma.subscriptionPlan.findUniqueOrThrow({ where: { key } });
  }

  async updatePrice(input: { planId: string; priceMonthly: number }) {
    return this.prisma.subscriptionPlan.update({ where: { id: input.planId }, data: { priceMonthly: input.priceMonthly } });
  }

  /** The Billing page's one data source — plan, stored status, and the freshly-computed effective access (§5.4). */
  async getSubscriptionStatus(organizationId: string) {
    const [sub, enabledModules] = await Promise.all([
      this.prisma.subscription.findUniqueOrThrow({ where: { organizationId }, include: { plan: true } }),
      this.prisma.organizationModule.findMany({ where: { organizationId, enabled: true }, select: { module: true } }),
    ]);
    const access = resolveSubscriptionAccess(sub);
    return {
      planName: sub.plan.name,
      priceMonthly: sub.plan.priceMonthly,
      status: sub.status,
      effectiveStatus: access.effectiveStatus,
      locked: access.locked,
      daysLeftInTrial: access.daysLeftInTrial,
      trialEndsAt: sub.trialEndsAt,
      currentPeriodEnd: sub.currentPeriodEnd,
      // Settings → Billing (§ user request): "which module(s) did we actually buy" — the plan name
      // alone doesn't say that once a plan bundles more than one module.
      enabledModules: enabledModules.map((m) => m.module),
    };
  }

  /**
   * Dev/demo stand-in for a real gateway renewal webhook (StubPaymentGateway is the only
   * "gateway" that exists today — no Razorpay credentials yet) — extends the paid period by one
   * billing cycle and marks the subscription active again, exactly what a real successful renewal
   * charge would do to this row.
   */
  async simulateRenewal(organizationId: string) {
    const sub = await this.prisma.subscription.findUniqueOrThrow({ where: { organizationId } });
    const now = new Date();
    const base = sub.currentPeriodEnd > now ? sub.currentPeriodEnd : now;
    return this.prisma.subscription.update({
      where: { organizationId },
      data: { status: 'active', currentPeriodStart: now, currentPeriodEnd: new Date(base.getTime() + BILLING_CYCLE_DAYS * 86400000) },
    });
  }
}
