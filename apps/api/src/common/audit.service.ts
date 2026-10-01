import { Injectable } from '@nestjs/common';
import type { AuditEventType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  log(input: { hotelId: string; eventType: AuditEventType; actorId: string; subjectId?: string; detail?: Prisma.InputJsonValue }) {
    return this.prisma.auditLog.create({
      data: {
        hotelId: input.hotelId,
        eventType: input.eventType,
        actorId: input.actorId,
        subjectId: input.subjectId,
        detail: input.detail,
      },
    });
  }

  /** Phase 2's "Audit logs screen" (§7) — a plain read over audit_log, nearly free given its own design. `actorId` has no FK (it's a loose reference, same spirit as `inventory_rates.changed_by`), so names are resolved here in one extra lookup rather than joined. */
  async list(input: { hotelId: string; limit?: number }) {
    const rows = await this.prisma.auditLog.findMany({
      where: { hotelId: input.hotelId },
      orderBy: { createdAt: 'desc' },
      take: input.limit ?? 200,
    });
    const actorIds = [...new Set(rows.map((r) => r.actorId))];
    const users = await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } });
    const nameById = new Map(users.map((u) => [u.id, u.name]));
    return rows.map((r) => ({ ...r, actorName: nameById.get(r.actorId) ?? 'Unknown' }));
  }
}
