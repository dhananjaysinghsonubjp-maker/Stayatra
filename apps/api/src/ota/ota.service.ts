import { Injectable } from '@nestjs/common';
import { OtaCode, type AuditEventType, type Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CredentialVaultService } from './credential-vault.service.js';
import { AuditService } from '../common/audit.service.js';

// Placeholder for §2's real sync architecture — creates the connection record
// (status 'pending') so the CM grid has something to key off of. Real
// adapter/job-queue wiring (per OTA) is separate, deferred work.
@Injectable()
export class OtaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vault: CredentialVaultService,
    private readonly audit: AuditService,
  ) {}

  private async logCmEvent(otaConnectionId: string, eventType: AuditEventType, actorId: string, detail?: Prisma.InputJsonObject) {
    const connection = await this.prisma.otaConnection.findUnique({ where: { id: otaConnectionId }, select: { hotelId: true } });
    if (!connection) return;
    await this.audit.log({ hotelId: connection.hotelId, eventType, actorId, detail });
  }

  async createConnection(input: { hotelId: string; otaCode: OtaCode; actorId: string }) {
    const connection = await this.prisma.otaConnection.upsert({
      where: { hotelId_otaCode: { hotelId: input.hotelId, otaCode: input.otaCode } },
      create: { hotelId: input.hotelId, otaCode: input.otaCode, status: 'pending' },
      update: {},
    });
    await this.audit.log({ hotelId: input.hotelId, eventType: 'CHANNEL_CONNECTED', actorId: input.actorId, detail: { otaCode: input.otaCode } });
    return connection;
  }

  async listConnections(hotelId: string) {
    return this.prisma.otaConnection.findMany({ where: { hotelId } });
  }

  async mapRoomCategory(input: { otaConnectionId: string; roomCategoryId: string; otaRoomName: string; otaRoomCode?: string; otaRatePlanCode?: string; actorId: string }) {
    const { actorId, ...data } = input;
    const result = await this.prisma.otaRoomMapping.upsert({
      where: { otaConnectionId_roomCategoryId: { otaConnectionId: data.otaConnectionId, roomCategoryId: data.roomCategoryId } },
      create: data,
      update: { otaRoomName: data.otaRoomName, otaRoomCode: data.otaRoomCode, otaRatePlanCode: data.otaRatePlanCode },
    });
    await this.logCmEvent(input.otaConnectionId, 'ROOM_MAPPING_UPDATED', actorId, { roomCategoryId: input.roomCategoryId });
    return result;
  }

  /** Feeds the mapping wizard's "X of N mapped" progress (§10, §7 Phase 1 #6). */
  async listRoomMappings(otaConnectionId: string) {
    return this.prisma.otaRoomMapping.findMany({ where: { otaConnectionId } });
  }

  async removeRoomMapping(input: { otaConnectionId: string; roomCategoryId: string }) {
    return this.prisma.otaRoomMapping.delete({
      where: { otaConnectionId_roomCategoryId: input },
    });
  }

  async setCredentials(input: { otaConnectionId: string; credentials: Record<string, string>; actorId: string }) {
    // Never log which fields or values were touched — only that a save happened (§7 Phase 1 #13: credentials are encrypted, and that extends to keeping even their field names out of the audit trail).
    const result = await this.vault.storeCredentials(input.otaConnectionId, input.credentials);
    await this.logCmEvent(input.otaConnectionId, 'CREDENTIALS_UPDATED', input.actorId);
    return result;
  }

  async getCredentialStatus(otaConnectionId: string) {
    return this.vault.getStatus(otaConnectionId);
  }

  /** §6's channel economics — feeds "payable to property" on the bookings table without a second accounting system. */
  async setCommissionRate(input: { otaConnectionId: string; commissionRatePercent: number | null }) {
    return this.prisma.otaConnection.update({
      where: { id: input.otaConnectionId },
      data: { commissionRatePercent: input.commissionRatePercent },
    });
  }
}
