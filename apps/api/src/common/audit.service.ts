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
}
