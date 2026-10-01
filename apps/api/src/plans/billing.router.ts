import { TRPCError } from '@trpc/server';
import { authedProcedure, authedProcedureNoSubscriptionGate, router } from '../trpc/trpc.js';
import type { PlansService } from './plans.service.js';

/** Owner in any module — billing concerns the whole org, not one module's staff. */
const ownerAnyModule = authedProcedureNoSubscriptionGate.use(({ ctx, next }) => {
  if (!Object.values(ctx.user.roles).includes('owner')) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Owner access required' });
  }
  return next();
});

export function createBillingRouter(plans: PlansService) {
  return router({
    getStatus: authedProcedure.query(({ ctx }) => plans.getSubscriptionStatus(ctx.user.organizationId)),

    // Deliberately NOT built on the subscription-gated `authedProcedure` — this is the one
    // mutation that must still work while locked, or a locked-out owner could never renew.
    simulateRenewal: ownerAnyModule.mutation(({ ctx }) => plans.simulateRenewal(ctx.user.organizationId)),
  });
}
