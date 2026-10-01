import { Inject, Injectable, ConflictException, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { customAlphabet } from 'nanoid';
import { PrismaService } from '../prisma/prisma.service.js';
import { PlansService } from '../plans/plans.service.js';
import { PAYMENT_GATEWAY, type PaymentGateway } from '../plans/payment-gateway.interface.js';
import { resolveSubscriptionAccess } from '../plans/subscription-status.js';

const TRIAL_DAYS = 7; // §5.4 default
const BILLING_CYCLE_DAYS = 30;

const SESSION_TOKEN_LENGTH = 48;
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const PIN_LOCKOUT_THRESHOLD = 5;
const PIN_LOCKOUT_WINDOW_MS = 1000 * 60 * 15;

const generateToken = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', SESSION_TOKEN_LENGTH);
const generateShortCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6); // no ambiguous chars

export interface SessionResult {
  token: string;
  userId: string;
  expiresAt: Date;
}

// Spec (§4) calls for "JWT access + refresh token" for owner/manager and a
// separate "PIN-based session token... same underlying session mechanism" for
// PMS staff. MVP simplification: both paths issue one opaque, revocable
// bearer token backed by `sessions` — same mechanism, no JWT verification/
// refresh-rotation complexity to build before there's a second client to
// justify it. Revisit if stateless verification actually becomes a bottleneck.
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: PlansService,
    @Inject(PAYMENT_GATEWAY) private readonly paymentGateway: PaymentGateway,
  ) {}

  private async createSession(userId: string): Promise<SessionResult> {
    const token = generateToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await this.prisma.session.create({ data: { userId, token, expiresAt } });
    return { token, userId, expiresAt };
  }

  /**
   * Creates a new organization with its owner account, entitled to exactly
   * the modules the chosen plan grants (§5.4/§5.5 — added beyond MD spec's
   * simpler 3-package table at user request: every module and combination
   * sold as its own plan). The payment gateway call is stubbed today — see
   * StubPaymentGateway — so "buying" a plan activates it immediately rather
   * than waiting on a real charge.
   */
  async signup(input: { organizationName: string; ownerName: string; email: string; password: string; planKey: string }) {
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw new ConflictException('An account with this email already exists');

    const plan = await this.plans.getPlanByKey(input.planKey);
    const passwordHash = await bcrypt.hash(input.password, 12);

    const org = await this.prisma.organization.create({
      data: {
        name: input.organizationName,
        modules: { create: plan.modules.map((module) => ({ module, enabled: true })) },
        users: {
          create: {
            name: input.ownerName,
            email: input.email,
            passwordHash,
            moduleRoles: { create: plan.modules.map((module) => ({ module, role: 'owner' })) },
          },
        },
      },
      include: { users: true },
    });

    const gatewayResult = await this.paymentGateway.createSubscription({
      organizationId: org.id,
      planKey: plan.key,
      priceMonthly: Number(plan.priceMonthly),
    });
    const now = new Date();
    await this.prisma.subscription.create({
      data: {
        organizationId: org.id,
        planId: plan.id,
        status: gatewayResult.active ? 'active' : 'trialing',
        trialEndsAt: new Date(now.getTime() + TRIAL_DAYS * 86400000),
        currentPeriodStart: now,
        currentPeriodEnd: new Date(now.getTime() + BILLING_CYCLE_DAYS * 86400000),
        gatewayReference: gatewayResult.gatewayReference,
      },
    });

    const owner = org.users[0];
    const session = await this.createSession(owner.id);
    return { session, userId: owner.id, organizationId: org.id };
  }

  async login(input: { email: string; password: string }) {
    const user = await this.prisma.user.findUnique({ where: { email: input.email }, include: { organization: true } });
    if (!user || !user.passwordHash) throw new UnauthorizedException('Invalid email or password');

    const valid = await bcrypt.compare(input.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid email or password');
    if (user.organization.suspended) throw new ForbiddenException('This account has been suspended. Contact support.');

    const session = await this.createSession(user.id);
    return { session, userId: user.id, organizationId: user.organizationId };
  }

  /** Front Desk / Housekeeping login: Hotel ID (short_code) + PIN, no email (§8.1). */
  async pinLogin(input: { shortCode: string; pin: string; deviceId: string }) {
    const hotel = await this.prisma.hotel.findUnique({ where: { shortCode: input.shortCode }, include: { organization: true } });
    if (!hotel) throw new UnauthorizedException('Invalid Hotel ID or PIN');
    if (hotel.organization.suspended) throw new ForbiddenException('This account has been suspended. Contact support.');

    const windowStart = new Date(Date.now() - PIN_LOCKOUT_WINDOW_MS);
    const recentFailures = await this.prisma.loginAttempt.count({
      where: { hotelId: hotel.id, deviceId: input.deviceId, succeeded: false, attemptedAt: { gte: windowStart } },
    });
    if (recentFailures >= PIN_LOCKOUT_THRESHOLD) {
      throw new ForbiddenException('Too many failed attempts on this device. Ask an owner/manager to clear the lockout.');
    }

    const candidates = await this.prisma.user.findMany({
      where: { hotelId: hotel.id, pinHash: { not: null } },
    });

    let matched: (typeof candidates)[number] | undefined;
    for (const candidate of candidates) {
      if (candidate.pinHash && (await bcrypt.compare(input.pin, candidate.pinHash))) {
        matched = candidate;
        break;
      }
    }

    await this.prisma.loginAttempt.create({
      data: { hotelId: hotel.id, deviceId: input.deviceId, succeeded: Boolean(matched) },
    });

    if (!matched) throw new UnauthorizedException('Invalid Hotel ID or PIN');

    const session = await this.createSession(matched.id);
    return { session, userId: matched.id, organizationId: matched.organizationId, hotelId: hotel.id };
  }

  /** Owner/manager only — staff never self-register (§8.2). */
  async createStaffPin(input: { hotelId: string; name: string; role: 'front_desk' | 'housekeeping'; pin: string }) {
    if (!/^\d{4,6}$/.test(input.pin)) throw new ConflictException('PIN must be 4-6 digits');

    const existingPins = await this.prisma.user.findMany({
      where: { hotelId: input.hotelId, pinHash: { not: null } },
      select: { pinHash: true },
    });
    for (const { pinHash } of existingPins) {
      if (pinHash && (await bcrypt.compare(input.pin, pinHash))) {
        throw new ConflictException('That PIN is already in use at this hotel — PINs must be unique per hotel');
      }
    }

    const hotel = await this.prisma.hotel.findUniqueOrThrow({ where: { id: input.hotelId } });
    const pinHash = await bcrypt.hash(input.pin, 10);

    return this.prisma.user.create({
      data: {
        organizationId: hotel.organizationId,
        hotelId: input.hotelId,
        name: input.name,
        pinHash,
        moduleRoles: { create: [{ module: 'pms', role: input.role }] },
      },
    });
  }

  static mintShortCode() {
    return generateShortCode();
  }

  /** Resolves a bearer token to the acting user + their module roles. Never trust a client-supplied role (§4). */
  async resolveSession(token: string) {
    const session = await this.prisma.session.findUnique({
      where: { token },
      include: { user: { include: { moduleRoles: true, organization: { include: { subscription: true } } } } },
    });
    if (!session || !session.user || session.expiresAt < new Date()) return null;
    if (session.user.organization.suspended) return null; // suspended mid-session — signed out on the next request, not just the next login

    const sub = session.user.organization.subscription;
    // No subscription row is a data gap (shouldn't happen via signup — every real org gets one),
    // not a reason to lock an account out — default to unrestricted rather than punish missing data.
    const subscriptionAccess = sub
      ? resolveSubscriptionAccess(sub)
      : { effectiveStatus: 'active' as const, locked: false, daysLeftInTrial: null };

    return {
      userId: session.user.id,
      organizationId: session.user.organizationId,
      hotelId: session.user.hotelId,
      roles: Object.fromEntries(session.user.moduleRoles.map((r) => [r.module, r.role])) as Record<string, string>,
      subscriptionAccess,
    };
  }
}
