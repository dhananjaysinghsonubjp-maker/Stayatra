import { initTRPC, TRPCError } from '@trpc/server';
import type { Context } from './context.js';

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

// Server resolves user_id -> organization_id -> entitled modules -> role per
// module on every call (§4) — never trust a client-supplied role.
export const authedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
  return next({ ctx: { ...ctx, user: ctx.user } });
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
