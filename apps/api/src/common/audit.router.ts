import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { authedProcedure, router } from '../trpc/trpc.js';
import type { AuditService } from './audit.service.js';

const MANAGE_ROLES = ['owner', 'manager'];

/** Owner/manager on *either* module — the audit trail isn't module-scoped content, so a PMS-only owner needs the same read a CM-only owner gets. */
const canViewAudit = authedProcedure.use(({ ctx, next }) => {
  const roles = ctx.user.roles;
  if (!MANAGE_ROLES.includes(roles.channel_manager ?? '') && !MANAGE_ROLES.includes(roles.pms ?? '')) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Requires owner/manager on a module for this hotel' });
  }
  return next();
});

export function createAuditRouter(audit: AuditService) {
  return router({
    list: canViewAudit
      .input(z.object({ hotelId: z.string(), limit: z.number().int().positive().max(500).optional() }))
      .query(({ input }) => audit.list(input)),
  });
}
