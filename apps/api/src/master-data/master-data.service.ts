import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../common/audit.service.js';
import { BASE_ROLES, PERMISSION_KEYS, type BaseRole } from '../common/permission-catalog.js';

/**
 * §user request, with a reference app's own "Master Data" section as the target — Role
 * Management (real, owner-authored custom roles with granular sidebar-section permissions, each
 * tied to one of the app's existing fixed roles for actual backend access — see CustomRole's own
 * schema comment), User Management (who has which role), and a few lightweight standalone lists
 * (Departments, Employee Types, Daily Issues Log) the reference also showed.
 */
@Injectable()
export class MasterDataService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── Custom roles (Role Management) ────────────────────────────────────────

  async listCustomRoles(hotelId: string) {
    const roles = await this.prisma.customRole.findMany({
      where: { hotelId },
      include: { _count: { select: { users: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return roles.map((r) => ({ ...r, userCount: r._count.users }));
  }

  private validatePermissions(permissions: string[]) {
    const invalid = permissions.filter((p) => !PERMISSION_KEYS.includes(p));
    if (invalid.length > 0) throw new BadRequestException(`Unknown permission(s): ${invalid.join(', ')}`);
  }

  async createCustomRole(input: { hotelId: string; name: string; description?: string; baseRole: string; permissions: string[]; actorId: string }) {
    if (!BASE_ROLES.includes(input.baseRole as BaseRole)) throw new BadRequestException('Invalid base role');
    this.validatePermissions(input.permissions);
    const role = await this.prisma.customRole.create({
      data: { hotelId: input.hotelId, name: input.name, description: input.description, baseRole: input.baseRole, permissions: input.permissions },
    });
    await this.audit.log({ hotelId: input.hotelId, eventType: 'CUSTOM_ROLE_UPDATED', actorId: input.actorId, subjectId: role.id, detail: { action: 'created', name: input.name } });
    return role;
  }

  async updateCustomRole(input: { roleId: string; name?: string; description?: string; baseRole?: string; permissions?: string[]; active?: boolean; actorId: string }) {
    const existing = await this.prisma.customRole.findUniqueOrThrow({ where: { id: input.roleId } });
    if (input.baseRole && !BASE_ROLES.includes(input.baseRole as BaseRole)) throw new BadRequestException('Invalid base role');
    if (input.permissions) this.validatePermissions(input.permissions);
    const role = await this.prisma.customRole.update({
      where: { id: input.roleId },
      data: { name: input.name, description: input.description, baseRole: input.baseRole, permissions: input.permissions, active: input.active },
    });
    // A changed baseRole must resync every user already holding this role, or their real backend
    // access would silently drift from what Role Management now says they should have.
    if (input.baseRole) {
      await this.prisma.userModuleRole.updateMany({ where: { user: { customRoleId: role.id }, module: 'pms' }, data: { role: input.baseRole } });
    }
    await this.audit.log({ hotelId: existing.hotelId, eventType: 'CUSTOM_ROLE_UPDATED', actorId: input.actorId, subjectId: role.id, detail: { action: 'updated' } });
    return role;
  }

  async deleteCustomRole(input: { roleId: string; actorId: string }) {
    const existing = await this.prisma.customRole.findUniqueOrThrow({ where: { id: input.roleId } });
    // Explicit unassign rather than relying on the FK's onDelete: SetNull — makes the effect on
    // currently-assigned users an intentional, logged part of this action.
    await this.prisma.user.updateMany({ where: { customRoleId: input.roleId }, data: { customRoleId: null } });
    await this.prisma.customRole.delete({ where: { id: input.roleId } });
    await this.audit.log({ hotelId: existing.hotelId, eventType: 'CUSTOM_ROLE_UPDATED', actorId: input.actorId, subjectId: input.roleId, detail: { action: 'deleted', name: existing.name } });
    return { ok: true };
  }

  // ── User & Access (User Management) ───────────────────────────────────────

  async listUsersForAccess(hotelId: string) {
    const users = await this.prisma.user.findMany({
      where: { hotelId },
      include: { moduleRoles: true, customRole: true },
      orderBy: { createdAt: 'asc' },
    });
    return users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      phone: u.phone,
      active: u.active,
      pmsRole: u.moduleRoles.find((r) => r.module === 'pms')?.role ?? null,
      customRoleId: u.customRoleId,
      customRoleName: u.customRole?.name ?? null,
    }));
  }

  async assignCustomRole(input: { userId: string; customRoleId: string | null; actorId: string }) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: input.userId } });
    if (!user.hotelId) throw new BadRequestException('User has no hotel yet');
    if (input.customRoleId) {
      const role = await this.prisma.customRole.findUniqueOrThrow({ where: { id: input.customRoleId } });
      if (role.hotelId !== user.hotelId) throw new ForbiddenException('That role belongs to a different hotel');
      await this.prisma.$transaction([
        this.prisma.user.update({ where: { id: input.userId }, data: { customRoleId: input.customRoleId } }),
        this.prisma.userModuleRole.upsert({
          where: { userId_module: { userId: input.userId, module: 'pms' } },
          create: { userId: input.userId, module: 'pms', role: role.baseRole },
          update: { role: role.baseRole },
        }),
      ]);
    } else {
      await this.prisma.user.update({ where: { id: input.userId }, data: { customRoleId: null } });
    }
    await this.audit.log({ hotelId: user.hotelId, eventType: 'CUSTOM_ROLE_UPDATED', actorId: input.actorId, subjectId: input.userId, detail: { customRoleId: input.customRoleId } });
    return { ok: true };
  }

  // ── Daily Issues Log ───────────────────────────────────────────────────────

  async listDailyIssues(input: { hotelId: string; status?: 'open' | 'resolved' }) {
    const rows = await this.prisma.dailyIssue.findMany({
      where: { hotelId: input.hotelId, status: input.status },
      orderBy: { createdAt: 'desc' },
    });
    const userIds = [...new Set(rows.flatMap((r) => [r.reportedByUserId, r.resolvedByUserId].filter((x): x is string => !!x)))];
    const users = await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
    const nameById = new Map(users.map((u) => [u.id, u.name]));
    return rows.map((r) => ({
      ...r,
      reportedByName: nameById.get(r.reportedByUserId) ?? '—',
      resolvedByName: r.resolvedByUserId ? (nameById.get(r.resolvedByUserId) ?? '—') : null,
    }));
  }
  createDailyIssue(input: { hotelId: string; title: string; description?: string; reportedByUserId: string }) {
    return this.prisma.dailyIssue.create({ data: input });
  }
  resolveDailyIssue(input: { id: string; resolvedByUserId: string }) {
    return this.prisma.dailyIssue.update({ where: { id: input.id }, data: { status: 'resolved', resolvedByUserId: input.resolvedByUserId, resolvedAt: new Date() } });
  }
  reopenDailyIssue(id: string) {
    return this.prisma.dailyIssue.update({ where: { id }, data: { status: 'open', resolvedByUserId: null, resolvedAt: null } });
  }
}
