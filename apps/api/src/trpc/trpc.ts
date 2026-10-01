import { initTRPC, TRPCError } from '@trpc/server';
import type { Context } from './context.js';

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

// Server resolves user_id -> organization_id -> entitled modules -> role per
// module on every call (§4) — never trust a client-supplied role.
// Auth only, no subscription gate — the one thing this must stay under is the
// billing router's own renew mutation: gating that too would mean a locked-out
// owner could never call the one mutation that unlocks them again.
export const authedProcedureNoSubscriptionGate = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
  return next({ ctx: { ...ctx, user: ctx.user } });
});

// §5.4's trial/grace/lock gate: reads always stay open (so a locked-out owner can still see
// their data and the Billing page), but every write is refused once trial+grace has lapsed with
// no active paid period — this is the one place that rule is enforced, not per-router.
export const authedProcedure = authedProcedureNoSubscriptionGate.use(({ ctx, type, next }) => {
  if (type === 'mutation' && ctx.user.subscriptionAccess.locked) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Your subscription has lapsed — renew from the Billing page to keep making changes.',
    });
  }
  return next();
});

/** Restricts a procedure to specific roles within a module (mirrors what a Nest guard would enforce). */
export function requireRole(module: 'channel_manager' | 'pms' | 'theft_protection', allowedRoles: string[]) {
  return authedProcedure.use(({ ctx, next }) => {
    const role = ctx.user.roles[module];
    if (!role || !allowedRoles.includes(role)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: `Requires one of [${allowedRoles.join(', ')}] on ${module}` });
    }
    return next();
  });
}

/** A platform operator's own procedure type — entirely separate from tenant `authedProcedure`/`requireRole` (see PlatformAdmin's schema comment for why). */
export const platformAdminProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.platformAdmin) throw new TRPCError({ code: 'UNAUTHORIZED' });
  return next({ ctx: { ...ctx, platformAdmin: ctx.platformAdmin } });
});

/** A reseller/white-label partner's own procedure type — scoping to their own referred organizations happens in AffiliateService, not here. */
export const affiliateProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.affiliate) throw new TRPCError({ code: 'UNAUTHORIZED' });
  return next({ ctx: { ...ctx, affiliate: ctx.affiliate } });
});
