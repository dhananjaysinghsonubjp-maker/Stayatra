import { Injectable, ConflictException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthService } from '../auth/auth.service.js';

@Injectable()
export class HotelsService {
  constructor(private readonly prisma: PrismaService) {}

  /** §8.2 step 1: mints hotels.short_code immediately, shown to the owner to write down/print for staff. */
  async createHotel(input: {
    organizationId: string;
    name: string;
    addressLine?: string;
    apartmentOrFloor?: string;
    city?: string;
    state?: string;
    pincode?: string;
    latitude?: number;
    longitude?: number;
    gstRegistration?: string;
    expectedRoomCount?: number;
    expectedStaffCount?: number;
    starRating?: number;
    builtYear?: number;
    acceptingBookingsSince?: number;
    contactEmail?: string;
    contactMobile?: string;
    contactMobileIsWhatsapp?: boolean;
    contactLandline?: string;
    dpdpConsent: boolean;
  }) {
    // §11 — real consent, not a formality: a hotel record (and the guest PII it'll go on to hold)
    // can't be created without the owner having actually agreed, so this isn't just UI-side polish.
    if (!input.dpdpConsent) throw new BadRequestException('DPDP data-processing consent is required to create a hotel');

    for (let attempt = 0; attempt < 5; attempt++) {
      const shortCode = AuthService.mintShortCode();
      try {
        return await this.prisma.hotel.create({
          data: {
            organizationId: input.organizationId,
            name: input.name,
            addressLine: input.addressLine,
            apartmentOrFloor: input.apartmentOrFloor,
            city: input.city,
            state: input.state,
            pincode: input.pincode,
            latitude: input.latitude,
            longitude: input.longitude,
            shortCode,
            gstRegistration: input.gstRegistration,
            expectedRoomCount: input.expectedRoomCount,
            expectedStaffCount: input.expectedStaffCount,
            starRating: input.starRating,
            builtYear: input.builtYear,
            acceptingBookingsSince: input.acceptingBookingsSince,
            contactEmail: input.contactEmail || undefined,
            contactMobile: input.contactMobile,
            contactMobileIsWhatsapp: input.contactMobileIsWhatsapp ?? false,
            contactLandline: input.contactLandline,
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

  /** Settings → Hotel Details (§ user request: the onboarding wizard's own fields, editable afterward instead of write-once). */
  async updateBasicInfo(input: {
    hotelId: string;
    name?: string;
    starRating?: number | null;
    builtYear?: number | null;
    acceptingBookingsSince?: number | null;
    contactEmail?: string;
    contactMobile?: string;
    contactMobileIsWhatsapp?: boolean;
    contactLandline?: string;
  }) {
    const { hotelId, ...fields } = input;
    return this.prisma.hotel.update({ where: { id: hotelId }, data: fields });
  }

  /** Settings → Hotel Details — the address/map-pin step, editable afterward. */
  async updateAddress(input: {
    hotelId: string;
    addressLine?: string;
    apartmentOrFloor?: string;
    city?: string;
    state?: string;
    pincode?: string;
    latitude?: number | null;
    longitude?: number | null;
  }) {
    const { hotelId, ...fields } = input;
    return this.prisma.hotel.update({ where: { id: hotelId }, data: fields });
  }

  /** "List Your Property" step 4 (Policies) — applied after the hotel already exists. */
  async updatePolicies(input: {
    hotelId: string;
    checkInTime?: string;
    checkOutTime?: string;
    cancellationPolicy?: 'free_till_checkin' | 'free_24h' | 'free_48h' | 'free_72h' | 'non_refundable';
    allowUnmarriedCouples?: boolean;
  }) {
    return this.prisma.hotel.update({
      where: { id: input.hotelId },
      data: {
        checkInTime: input.checkInTime,
        checkOutTime: input.checkOutTime,
        cancellationPolicy: input.cancellationPolicy,
        allowUnmarriedCouples: input.allowUnmarriedCouples,
      },
    });
  }

  /**
   * Mints a default "Standard Rate" plan alongside the category (§ user request: a room should
   * sync into the Calendar the moment it's set up, not stay invisible until the owner separately
   * visits Linked Rate Plan) — the Calendar only renders a row for a category once it has at
   * least one rate plan, so without this every freshly-created room silently had nowhere to show.
   */
  async createRoomCategory(input: { hotelId: string; name: string; description?: string }) {
    const category = await this.prisma.roomCategory.create({
      data: { hotelId: input.hotelId, name: input.name, description: input.description },
    });
    await this.prisma.ratePlan.create({ data: { roomCategoryId: category.id, name: 'Standard Rate' } });
    return category;
  }

  async updateRoomCategory(input: {
    roomCategoryId: string;
    name?: string;
    description?: string;
    active?: boolean;
    roomType?: string;
    roomView?: string;
    roomSizeSqft?: number;
    bedType?: string;
    maxOccupancy?: number;
    bathroomCount?: number;
    amenities?: string[];
  }) {
    const { roomCategoryId, ...fields } = input;
    return this.prisma.roomCategory.update({ where: { id: roomCategoryId }, data: fields });
  }

  /** The full "Room Details" page (§ user request) — category + its physical room count + its photo gallery, in one read. */
  async getRoomCategoryDetail(roomCategoryId: string) {
    const [category, roomCount, photos] = await Promise.all([
      this.prisma.roomCategory.findUniqueOrThrow({ where: { id: roomCategoryId } }),
      this.prisma.room.count({ where: { roomCategoryId, active: true } }),
      this.prisma.roomPhoto.findMany({ where: { roomCategoryId }, orderBy: { sortOrder: 'asc' } }),
    ]);
    return { ...category, roomCount, photos };
  }

  async addRoomPhoto(input: { roomCategoryId: string; filePath: string }) {
    const count = await this.prisma.roomPhoto.count({ where: { roomCategoryId: input.roomCategoryId } });
    return this.prisma.roomPhoto.create({ data: { roomCategoryId: input.roomCategoryId, filePath: input.filePath, sortOrder: count } });
  }

  async removeRoomPhoto(photoId: string) {
    await this.prisma.roomPhoto.delete({ where: { id: photoId } });
    return { ok: true };
  }

  /** "List Your Property" step 5 (Amenities) — applied after the hotel already exists. */
  async updateHotelAmenities(input: { hotelId: string; amenities: string[] }) {
    return this.prisma.hotel.update({ where: { id: input.hotelId }, data: { amenities: input.amenities } });
  }

  /** "List Your Property" step 6 (Photos And Videos) — property-level gallery, mirrors RoomPhoto. */
  async listHotelPhotos(hotelId: string) {
    return this.prisma.hotelPhoto.findMany({ where: { hotelId }, orderBy: { sortOrder: 'asc' } });
  }

  async addHotelPhoto(input: { hotelId: string; filePath: string }) {
    const count = await this.prisma.hotelPhoto.count({ where: { hotelId: input.hotelId } });
    return this.prisma.hotelPhoto.create({ data: { hotelId: input.hotelId, filePath: input.filePath, sortOrder: count } });
  }

  async removeHotelPhoto(photoId: string) {
    await this.prisma.hotelPhoto.delete({ where: { id: photoId } });
    return { ok: true };
  }

  /** "List Your Property" step 7 (Finance & Legal) — final step; hands off to the main app shell after this. */
  async updateFinance(input: {
    hotelId: string;
    gstRegistration?: string;
    panNumber?: string;
    bankAccountHolderName?: string;
    bankAccountNumber?: string;
    bankIfsc?: string;
  }) {
    const { hotelId, ...fields } = input;
    return this.prisma.hotel.update({ where: { id: hotelId }, data: fields });
  }

  /**
   * §8.2 step 2: "starting from N pre-created rows to edit is materially easier
   * than starting from zero." Rooms are created uncategorized (room_category_id
   * null) — the owner sorts them into categories afterward via assignCategory.
   */
  async generatePlaceholderRooms(input: { hotelId: string; count: number; roomCategoryId?: string }) {
    if (input.count < 1 || input.count > 500) throw new ConflictException('Room count must be between 1 and 500');

    const existingCount = await this.prisma.room.count({ where: { hotelId: input.hotelId } });
    const rooms = Array.from({ length: input.count }, (_, i) => ({
      hotelId: input.hotelId,
      roomNumber: `Room ${existingCount + i + 1}`,
      roomCategoryId: input.roomCategoryId,
    }));
    await this.prisma.room.createMany({ data: rooms });
    return this.prisma.room.findMany({ where: { hotelId: input.hotelId }, orderBy: { roomNumber: 'asc' } });
  }

  async assignRoomCategory(input: { roomId: string; roomCategoryId: string | null }) {
    return this.prisma.room.update({ where: { id: input.roomId }, data: { roomCategoryId: input.roomCategoryId } });
  }

  async renameRoom(input: { roomId: string; roomNumber: string }) {
    try {
      return await this.prisma.room.update({ where: { id: input.roomId }, data: { roomNumber: input.roomNumber } });
    } catch (err: unknown) {
      if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002') {
        throw new ConflictException(`Room "${input.roomNumber}" already exists`);
      }
      throw err;
    }
  }

  /** Adding one room at a time, alongside the bulk placeholder generator (§8.2 step 2). */
  async addRoom(input: { hotelId: string; roomNumber: string; roomCategoryId?: string | null }) {
    try {
      return await this.prisma.room.create({
        data: { hotelId: input.hotelId, roomNumber: input.roomNumber, roomCategoryId: input.roomCategoryId ?? null },
      });
    } catch (err: unknown) {
      if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002') {
        throw new ConflictException(`Room "${input.roomNumber}" already exists`);
      }
      throw err;
    }
  }

  /**
   * A room with no booking history (the common case — a placeholder added by
   * mistake, or one never actually used) is removed outright, freeing up its
   * room number for reuse. One with real history is soft-deleted (`active:
   * false`) instead, so past bookings/reports/cleaning records stay intact —
   * it just drops off Room Board and future check-in.
   */
  async deleteRoom(input: { roomId: string }) {
    const room = await this.prisma.room.findUniqueOrThrow({ where: { id: input.roomId } });
    if (room.status !== 'available') {
      throw new ConflictException('Cannot delete a room that is currently occupied or in housekeeping');
    }
    const bookingCount = await this.prisma.booking.count({ where: { assignedRoomId: input.roomId } });
    if (bookingCount === 0) {
      await this.prisma.room.delete({ where: { id: input.roomId } });
      return { id: input.roomId, deleted: true };
    }
    await this.prisma.room.update({ where: { id: input.roomId }, data: { active: false } });
    return { id: input.roomId, deleted: false };
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

  /** The sidebar's brand mark (§ user request). `filePath: null` removes it, falling back to the letter avatar. */
  async setHotelLogo(hotelId: string, filePath: string | null) {
    return this.prisma.hotel.update({ where: { id: hotelId }, data: { logoFilePath: filePath } });
  }

/** §user request — "ye colour option sirf Channel Manager + PMS + Theft Protection teeno
   * kharidne wale hotel ko milega": server-side enforcement, not just a hidden UI section — a
   * direct mutation call still has to clear this. `brandColor: null` (reverting to default)
   * is always allowed regardless of plan, since it only ever un-customizes. */
  async setBrandColor(hotelId: string, brandColor: string | null) {
    if (brandColor !== null) {
      const hotel = await this.prisma.hotel.findUniqueOrThrow({ where: { id: hotelId }, select: { organizationId: true } });
      const modules = await this.prisma.organizationModule.findMany({
        where: { organizationId: hotel.organizationId, enabled: true },
        select: { module: true },
      });
      const enabled = new Set<string>(modules.map((m) => m.module));
      const entitled = ['pms', 'channel_manager', 'theft_protection'].every((m) => enabled.has(m));
      if (!entitled) {
        throw new ForbiddenException('Custom brand colour requires the Channel Manager + PMS + Theft Protection plan.');
      }
    }
    return this.prisma.hotel.update({ where: { id: hotelId }, data: { brandColor } });
  }

  /** §user request — "Hotel Brand" → Banner Setup, simplified to text-on-brand-colour (no image). */
  async setBannerText(hotelId: string, bannerText: string | null) {
    return this.prisma.hotel.update({ where: { id: hotelId }, data: { bannerText } });
  }

  /** §user request — "Hotel Brand" → Font Setup (advanced). `fontFamily: null` reverts to the
   * app's current default. The router restricts this to a known set of font-stack ids, so no
   * arbitrary font name/CSS ever lands here. */
  async setFontFamily(hotelId: string, fontFamily: string | null) {
    return this.prisma.hotel.update({ where: { id: hotelId }, data: { fontFamily } });
  }

  /** §user request — Invoice Settings: licence/UPI/terms/toggles printed on the guest-facing
   * invoice. Partial updates — only the fields present in `input` are touched. */
  async updateInvoiceSettings(
    hotelId: string,
    input: {
      licenseNumber?: string | null;
      upiId?: string | null;
      invoiceTerms?: string | null;
      showPaymentSummaryOnInvoice?: boolean;
      showTermsOnInvoice?: boolean;
    },
  ) {
    return this.prisma.hotel.update({ where: { id: hotelId }, data: input });
  }

  async setInvoiceStamp(hotelId: string, filePath: string | null) {
    return this.prisma.hotel.update({ where: { id: hotelId }, data: { invoiceStampPath: filePath } });
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
