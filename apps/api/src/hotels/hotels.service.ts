import { Injectable, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthService } from '../auth/auth.service.js';

@Injectable()
export class HotelsService {
  constructor(private readonly prisma: PrismaService) {}

  /** §8.2 step 1: mints hotels.short_code immediately, shown to the owner to write down/print for staff. */
  async createHotel(input: {
    organizationId: string;
    name: string;
    city?: string;
    gstRegistration?: string;
    expectedRoomCount?: number;
    expectedStaffCount?: number;
    dpdpConsent: boolean;
  }) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const shortCode = AuthService.mintShortCode();
      try {
        return await this.prisma.hotel.create({
          data: {
            organizationId: input.organizationId,
            name: input.name,
            city: input.city,
            shortCode,
            gstRegistration: input.gstRegistration,
            expectedRoomCount: input.expectedRoomCount,
            expectedStaffCount: input.expectedStaffCount,
            dpdpConsentAt: input.dpdpConsent ? new Date() : null,
          },
        });
      } catch (err: unknown) {
        const isUniqueClash = typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';
        if (!isUniqueClash) throw err;
        // short_code collision — retry with a freshly minted code
      }
    }
    throw new ConflictException('Could not mint a unique Hotel ID, please retry');
  }

  async createRoomCategory(input: { hotelId: string; name: string }) {
    return this.prisma.roomCategory.create({ data: { hotelId: input.hotelId, name: input.name } });
  }

  /**
   * §8.2 step 2: "starting from N pre-created rows to edit is materially easier
   * than starting from zero." Rooms are created uncategorized (room_category_id
   * null) — the owner sorts them into categories afterward via assignCategory.
   */
  async generatePlaceholderRooms(input: { hotelId: string; count: number }) {
    if (input.count < 1 || input.count > 500) throw new ConflictException('Room count must be between 1 and 500');

    const existingCount = await this.prisma.room.count({ where: { hotelId: input.hotelId } });
    const rooms = Array.from({ length: input.count }, (_, i) => ({
      hotelId: input.hotelId,
      roomNumber: `Room ${existingCount + i + 1}`,
    }));
    await this.prisma.room.createMany({ data: rooms });
    return this.prisma.room.findMany({ where: { hotelId: input.hotelId }, orderBy: { roomNumber: 'asc' } });
  }

  async assignRoomCategory(input: { roomId: string; roomCategoryId: string | null }) {
    return this.prisma.room.update({ where: { id: input.roomId }, data: { roomCategoryId: input.roomCategoryId } });
  }

  async renameRoom(input: { roomId: string; roomNumber: string }) {
    return this.prisma.room.update({ where: { id: input.roomId }, data: { roomNumber: input.roomNumber } });
  }

  async listRooms(hotelId: string) {
    return this.prisma.room.findMany({
      where: { hotelId, active: true },
      include: { roomCategory: true },
      orderBy: { roomNumber: 'asc' },
    });
  }

  async listRoomCategories(hotelId: string) {
    return this.prisma.roomCategory.findMany({ where: { hotelId } });
  }

  async getHotel(hotelId: string) {
    return this.prisma.hotel.findUniqueOrThrow({ where: { id: hotelId } });
  }

  async listHotels(organizationId: string) {
    return this.prisma.hotel.findMany({ where: { organizationId } });
  }

  /** PIN-login staff roster for a hotel (Front Desk + Housekeeping) — §8.2. */
  async listStaff(hotelId: string) {
    const users = await this.prisma.user.findMany({
      where: { hotelId },
      include: { moduleRoles: { where: { module: 'pms' } } },
      orderBy: { createdAt: 'asc' },
    });
    return users.map((u) => ({ id: u.id, name: u.name, role: u.moduleRoles[0]?.role ?? null, createdAt: u.createdAt }));
  }
}
