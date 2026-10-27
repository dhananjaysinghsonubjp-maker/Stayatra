import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * §user request — hotel's own address book of outside vendors (electrician, plumber, …), not
 * guest/staff data. Flat list, free-text category, FMO/owner/manager can add, only owner can
 * delete (see contacts.router.ts's ownerOnly gate on deleteContact).
 */
@Injectable()
export class ContactsService {
  constructor(private readonly prisma: PrismaService) {}

  async listContacts(hotelId: string) {
    return this.prisma.hotelContact.findMany({ where: { hotelId }, orderBy: { createdAt: 'desc' } });
  }

  async createContact(input: { hotelId: string; name: string; category: string; phone: string }) {
    // §bugfix — same class of bug as the Property ID login fix: an invisible trailing/leading
    // space from a mobile keyboard or copy-paste would still pass client-side validation but then
    // silently break the frontend's category-match filter later. Trimming here means it can't
    // reach the database untrimmed via any client, not just the one that already trims.
    return this.prisma.hotelContact.create({
      data: { hotelId: input.hotelId, name: input.name.trim(), category: input.category.trim(), phone: input.phone.trim() },
    });
  }

  async deleteContact(contactId: string) {
    return this.prisma.hotelContact.delete({ where: { id: contactId } });
  }
}
