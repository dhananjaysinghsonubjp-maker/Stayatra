import { Injectable } from '@nestjs/common';
import type { Gender, IdType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export interface GuestDetails {
  title?: string;
  name: string;
  phone: string;
  email?: string;
  gender?: Gender;
  dateOfBirth?: Date;
  address?: string;
  country?: string;
  state?: string;
  city?: string;
  pincode?: string;
  idType?: IdType;
  idNumber?: string;
  idPhotoPath?: string;
  idPhotoBackPath?: string;
}

@Injectable()
export class GuestsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Phone-number search for the "saved guest? load their details" check-in flow. */
  async search(input: { hotelId: string; phone: string }) {
    return this.prisma.guest.findMany({
      where: { hotelId: input.hotelId, phone: { contains: input.phone } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
  }

  async get(id: string) {
    return this.prisma.guest.findUniqueOrThrow({ where: { id } });
  }

  /**
   * Check-in either links an existing profile (guestId given) or creates/
   * updates one by phone — the phone number is the de-facto key a repeat
   * guest is found by, matching the reference flow.
   */
  async upsertForCheckIn(hotelId: string, details: GuestDetails & { guestId?: string }): Promise<{ id: string }> {
    const data: Prisma.GuestUncheckedUpdateInput = {
      title: details.title,
      name: details.name,
      phone: details.phone,
      email: details.email,
      gender: details.gender,
      dateOfBirth: details.dateOfBirth,
      address: details.address,
      country: details.country,
      state: details.state,
      city: details.city,
      pincode: details.pincode,
      idType: details.idType,
      idNumber: details.idNumber,
      idPhotoPath: details.idPhotoPath,
      idPhotoBackPath: details.idPhotoBackPath,
    };

    if (details.guestId) {
      const updated = await this.prisma.guest.update({ where: { id: details.guestId }, data });
      return { id: updated.id };
    }

    const existing = await this.prisma.guest.findFirst({ where: { hotelId, phone: details.phone } });
    if (existing) {
      const updated = await this.prisma.guest.update({ where: { id: existing.id }, data });
      return { id: updated.id };
    }

    const created = await this.prisma.guest.create({ data: { hotelId, ...data } as Prisma.GuestUncheckedCreateInput });
    return { id: created.id };
  }
}
