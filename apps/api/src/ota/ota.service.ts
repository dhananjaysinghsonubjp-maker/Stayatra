import { Injectable } from '@nestjs/common';
import { OtaCode } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

// Placeholder for §2's real sync architecture — creates the connection record
// (status 'pending') so the CM grid has something to key off of. Real
// adapter/job-queue wiring (per OTA) is separate, deferred work.
@Injectable()
export class OtaService {
  constructor(private readonly prisma: PrismaService) {}

  async createConnection(input: { hotelId: string; otaCode: OtaCode }) {
    return this.prisma.otaConnection.upsert({
      where: { hotelId_otaCode: { hotelId: input.hotelId, otaCode: input.otaCode } },
      create: { hotelId: input.hotelId, otaCode: input.otaCode, status: 'pending' },
      update: {},
    });
  }

  async listConnections(hotelId: string) {
    return this.prisma.otaConnection.findMany({ where: { hotelId } });
  }

  async mapRoomCategory(input: { otaConnectionId: string; roomCategoryId: string; otaRoomName: string }) {
    return this.prisma.otaRoomMapping.upsert({
      where: { otaConnectionId_roomCategoryId: { otaConnectionId: input.otaConnectionId, roomCategoryId: input.roomCategoryId } },
      create: input,
      update: { otaRoomName: input.otaRoomName },
    });
  }
}
