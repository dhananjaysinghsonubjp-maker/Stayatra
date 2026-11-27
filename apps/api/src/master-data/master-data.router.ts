import { z } from 'zod';
import { router, requireRole } from '../trpc/trpc.js';
import type { MasterDataService } from './master-data.service.js';

const ownerOnly = requireRole('pms', ['owner']);
const ownerOrManager = requireRole('pms', ['owner', 'manager']);

export function createMasterDataRouter(masterData: MasterDataService) {
  return router({
    // Role Management — owner-only, since a role's permissions/base access level is itself a
    // security boundary (same spirit as staff approval/PIN-minting already being owner-only).
    listCustomRoles: ownerOnly.input(z.object({ hotelId: z.string() })).query(({ input }) => masterData.listCustomRoles(input.hotelId)),

    createCustomRole: ownerOnly
      .input(
        z.object({
          hotelId: z.string(),
          name: z.string().min(1),
          description: z.string().optional(),
          baseRole: z.enum(['owner', 'manager', 'front_desk', 'housekeeping']),
          permissions: z.array(z.string()),
        }),
      )
      .mutation(({ ctx, input }) => masterData.createCustomRole({ ...input, actorId: ctx.user.userId })),

    updateCustomRole: ownerOnly
      .input(
        z.object({
          roleId: z.string(),
          name: z.string().min(1).optional(),
          description: z.string().optional(),
          baseRole: z.enum(['owner', 'manager', 'front_desk', 'housekeeping']).optional(),
          permissions: z.array(z.string()).optional(),
          active: z.boolean().optional(),
        }),
      )
      .mutation(({ ctx, input }) => masterData.updateCustomRole({ ...input, actorId: ctx.user.userId })),

    deleteCustomRole: ownerOnly
      .input(z.object({ roleId: z.string() }))
      .mutation(({ ctx, input }) => masterData.deleteCustomRole({ roleId: input.roleId, actorId: ctx.user.userId })),

    // User Management — listing is fine for a manager too, but assigning a role is the same
    // security boundary as creating one, so owner-only.
    listUsersForAccess: ownerOrManager.input(z.object({ hotelId: z.string() })).query(({ input }) => masterData.listUsersForAccess(input.hotelId)),

    assignCustomRole: ownerOnly
      .input(z.object({ userId: z.string(), customRoleId: z.string().nullable() }))
      .mutation(({ ctx, input }) => masterData.assignCustomRole({ ...input, actorId: ctx.user.userId })),

    // Departments / Employee Types — plain operational tags, owner or manager.
    listDepartments: ownerOrManager.input(z.object({ hotelId: z.string() })).query(({ input }) => masterData.listDepartments(input.hotelId)),
    createDepartment: ownerOrManager
      .input(z.object({ hotelId: z.string(), name: z.string().min(1), description: z.string().optional() }))
      .mutation(({ input }) => masterData.createDepartment(input)),
    updateDepartment: ownerOrManager
      .input(z.object({ id: z.string(), name: z.string().min(1).optional(), description: z.string().optional(), active: z.boolean().optional() }))
      .mutation(({ input }) => masterData.updateDepartment(input)),
    deleteDepartment: ownerOrManager.input(z.object({ id: z.string() })).mutation(({ input }) => masterData.deleteDepartment(input.id)),

    listEmployeeTypes: ownerOrManager.input(z.object({ hotelId: z.string() })).query(({ input }) => masterData.listEmployeeTypes(input.hotelId)),
    createEmployeeType: ownerOrManager.input(z.object({ hotelId: z.string(), name: z.string().min(1) })).mutation(({ input }) => masterData.createEmployeeType(input)),
    updateEmployeeType: ownerOrManager
      .input(z.object({ id: z.string(), name: z.string().min(1).optional(), active: z.boolean().optional() }))
      .mutation(({ input }) => masterData.updateEmployeeType(input)),
    deleteEmployeeType: ownerOrManager.input(z.object({ id: z.string() })).mutation(({ input }) => masterData.deleteEmployeeType(input.id)),

    // Daily Issues Log — anyone with pms access can report/resolve a day-to-day issue.
    listDailyIssues: ownerOrManager
      .input(z.object({ hotelId: z.string(), status: z.enum(['open', 'resolved']).optional() }))
      .query(({ input }) => masterData.listDailyIssues(input)),
    createDailyIssue: ownerOrManager
      .input(z.object({ hotelId: z.string(), title: z.string().min(1), description: z.string().optional() }))
      .mutation(({ ctx, input }) => masterData.createDailyIssue({ ...input, reportedByUserId: ctx.user.userId })),
    resolveDailyIssue: ownerOrManager
      .input(z.object({ id: z.string() }))
      .mutation(({ ctx, input }) => masterData.resolveDailyIssue({ id: input.id, resolvedByUserId: ctx.user.userId })),
    reopenDailyIssue: ownerOrManager.input(z.object({ id: z.string() })).mutation(({ input }) => masterData.reopenDailyIssue(input.id)),
  });
}
