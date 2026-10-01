import { Injectable } from '@nestjs/common';
import type { NotificationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  create(input: { hotelId: string; type: NotificationType; title: string; body: string; link?: string }) {
    return this.prisma.notification.create({ data: input });
  }

  list(input: { hotelId: string; unreadOnly?: boolean; limit?: number }) {
    return this.prisma.notification.findMany({
      where: { hotelId: input.hotelId, ...(input.unreadOnly ? { read: false } : {}) },
      orderBy: { createdAt: 'desc' },
      take: input.limit ?? 30,
    });
  }

  unreadCount(hotelId: string) {
    return this.prisma.notification.count({ where: { hotelId, read: false } });
  }

  markRead(id: string) {
    return this.prisma.notification.update({ where: { id }, data: { read: true } });
  }

  async markAllRead(hotelId: string) {
    await this.prisma.notification.updateMany({ where: { hotelId, read: false }, data: { read: true } });
    return { ok: true };
  }
}
