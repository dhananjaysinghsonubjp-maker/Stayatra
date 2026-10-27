import { Inject, Injectable, ConflictException, ForbiddenException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../common/audit.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { MESSAGING_GATEWAY, type MessagingGateway } from './messaging-gateway.interface.js';

/**
 * §user request — a full staff profile (photo, phone, Aadhar) with an approval step, not just a
 * name+PIN. A GM/FMO can PROPOSE a profile for GM/housekeeping staff; only an owner can
 * approve/reject it, remove it, or mint the PIN. An owner proposing one themselves skips the
 * approval step — there's no one else to approve it.
 *
 * §user request (2026-10-15) — "ye saara FMO ki ID mein daal do": a GM/FMO's `pms` role is
 * literally `manager`, not a separate narrow role — `manager` is already wired as a qualifying
 * role on essentially every router in this codebase (rates/bookings/reports/hotels/ledger/
 * cleaning/ota/guest-messaging/reviews/audit), so this one role value is what actually unlocks
 * Reports, the full Channel Manager grid, Settings and Audit Log for them, matching what the
 * owner sees apart from Billing (isOwner-gated specifically) and staff approval/PIN-minting
 * (kept ownerOnly below — confirmed explicitly, not part of this broadening).
 */
@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    @Inject(MESSAGING_GATEWAY) private readonly messaging: MessagingGateway,
  ) {}

  /** Shared by approve()'s auto-generated PIN and setPin()'s manual one — a PIN only has to be
   * unique among this hotel's other active staff, same rule either way. */
  private async generateUniquePin(hotelId: string, excludeUserId: string): Promise<string> {
    const existingPins = await this.prisma.user.findMany({
      where: { hotelId, pinHash: { not: null }, active: true, id: { not: excludeUserId } },
      select: { pinHash: true },
    });
    for (let attempt = 0; attempt < 20; attempt++) {
      const candidate = String(Math.floor(1000 + Math.random() * 9000));
      let clashes = false;
      for (const { pinHash } of existingPins) {
        if (pinHash && (await bcrypt.compare(candidate, pinHash))) {
          clashes = true;
          break;
        }
      }
      if (!clashes) return candidate;
    }
    throw new ConflictException('Could not generate a unique PIN — try again');
  }

  /** A manager also needs the channel_manager role (same 'manager' tier) to actually use the CM
   * tabs their pms role now unlocks in the sidebar — only if the hotel has that module at all. */
  private async grantChannelManagerRoleIfApplicable(hotelId: string, organizationId: string, userId: string) {
    const cmModule = await this.prisma.organizationModule.findFirst({
      where: { organizationId, module: 'channel_manager', enabled: true },
    });
    if (!cmModule) return;
    await this.prisma.userModuleRole.upsert({
      where: { userId_module: { userId, module: 'channel_manager' } },
      create: { userId, module: 'channel_manager', role: 'manager' },
      update: { role: 'manager' },
    });
  }

  async propose(input: {
    hotelId: string;
    name: string;
    role: 'manager' | 'housekeeping';
    designation?: string;
    shift?: string;
    phone?: string;
    photoPath?: string;
    idNumber?: string;
    idPhotoFrontPath?: string;
    idPhotoBackPath?: string;
    proposedBy: string;
    proposerIsOwner: boolean;
  }) {
    const hotel = await this.prisma.hotel.findUniqueOrThrow({ where: { id: input.hotelId } });
    const designation = input.designation ?? (input.role === 'housekeeping' ? 'Housekeeping Staff' : 'General Manager');

    const user = await this.prisma.user.create({
      data: {
        organizationId: hotel.organizationId,
        hotelId: input.hotelId,
        name: input.name,
        phone: input.phone,
        photoPath: input.photoPath,
        idType: input.idNumber ? 'aadhaar' : undefined,
        idNumber: input.idNumber,
        idPhotoFrontPath: input.idPhotoFrontPath,
        idPhotoBackPath: input.idPhotoBackPath,
        designation,
        shift: input.role === 'housekeeping' ? input.shift : undefined,
        approvalStatus: input.proposerIsOwner ? 'approved' : 'pending',
        proposedBy: input.proposedBy,
        moduleRoles: { create: [{ module: 'pms', role: input.role }] },
      },
    });

    if (input.role === 'manager') {
      await this.grantChannelManagerRoleIfApplicable(input.hotelId, hotel.organizationId, user.id);
    }

    await this.audit.log({
      hotelId: input.hotelId,
      eventType: 'STAFF_PROPOSED',
      actorId: input.proposedBy,
      subjectId: user.id,
      detail: { name: input.name, role: input.role, designation, autoApproved: input.proposerIsOwner },
    });

    // §user request — "dashboard pe highlight create nahi hua": only when this actually sits
    // in the owner's queue (a front_desk/GM proposal), not when the owner added it themselves.
    if (!input.proposerIsOwner) {
      await this.notifications.create({
        hotelId: input.hotelId,
        type: 'staff_pending_approval',
        title: 'New staff profile needs approval',
        body: `${input.name} (${designation}) was submitted for review.`,
        // §user request — Staff & PINs is gone as its own page; the roster now lives under
        // Hotel Team → Staff, same Tab id ('housekeeping') as that merged page.
        link: 'housekeeping',
      });
    }

    return user;
  }

  /** Any logged-in user — their OWN profile only (never anyone else's), by session id, so a
   * housekeeping/front-desk login can see their own real photo/phone/designation in their
   * Profile tab, which `listAll` (owner-only) can't give them. */
  async myProfile(userId: string) {
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { moduleRoles: { where: { module: 'pms' } } },
    });
    return {
      id: u.id,
      name: u.name,
      role: u.moduleRoles[0]?.role ?? null,
      designation: u.designation,
      shift: u.shift,
      phone: u.phone,
      photoPath: u.photoPath,
    };
  }

  /** Owner-only — the full roster with profile detail, not just name+role. Excludes the owner's
   * own row (that's "My PIN" above, not "Staff") and anyone removed. */
  async listAll(hotelId: string) {
    const users = await this.prisma.user.findMany({
      where: { hotelId, active: true },
      include: { moduleRoles: { where: { module: 'pms' } } },
      orderBy: { createdAt: 'desc' },
    });
    return users
      .filter((u) => u.moduleRoles[0] && u.moduleRoles[0].role !== 'owner')
      .map((u) => ({
        id: u.id,
        name: u.name,
        role: u.moduleRoles[0]?.role ?? null,
        designation: u.designation,
        shift: u.shift,
        phone: u.phone,
        photoPath: u.photoPath,
        idType: u.idType,
        idNumber: u.idNumber,
        idPhotoFrontPath: u.idPhotoFrontPath,
        idPhotoBackPath: u.idPhotoBackPath,
        approvalStatus: u.approvalStatus,
        approvalNote: u.approvalNote,
        hasPinSet: Boolean(u.pinHash),
        createdAt: u.createdAt,
      }));
  }

  /**
   * §user request — "FMO kabhi bhi PIN generate nahi karega, owner approve karte hi automatically
   * 4-digit PIN ban jaaye, WhatsApp pe chala jaaye nahi toh SMS pe": approval itself now mints the
   * PIN — there's no separate manual step for a brand-new profile. No real WhatsApp/SMS gateway
   * exists yet (MessagingGateway is a stub — see its interface), so `delivered` comes back false
   * and the PIN is also returned in plaintext here, once, so the owner who just clicked Approve
   * can relay it themselves in the meantime. It's never persisted or logged anywhere in plaintext
   * — only this return value carries it, and only to the owner who triggered this exact call.
   */
  async approve(input: { userId: string; resolvedBy: string }) {
    const existing = await this.prisma.user.findUniqueOrThrow({ where: { id: input.userId } });
    const pin = await this.generateUniquePin(existing.hotelId!, input.userId);
    const pinHash = await bcrypt.hash(pin, 10);

    const user = await this.prisma.user.update({
      where: { id: input.userId },
      data: {
        approvalStatus: 'approved',
        approvalResolvedBy: input.resolvedBy,
        approvalResolvedAt: new Date(),
        approvalNote: null,
        pinHash,
      },
    });
    await this.audit.log({ hotelId: user.hotelId!, eventType: 'STAFF_APPROVED', actorId: input.resolvedBy, subjectId: user.id });
    await this.audit.log({ hotelId: user.hotelId!, eventType: 'STAFF_PIN_SET', actorId: input.resolvedBy, subjectId: user.id, detail: { auto: true } });

    // The staff member logs in with the Property ID (hotel.shortCode), not the internal hotel id
    // — that's what any real WhatsApp/SMS message would need to actually say.
    const hotel = await this.prisma.hotel.findUniqueOrThrow({ where: { id: user.hotelId! }, select: { shortCode: true } });
    const delivery = user.phone
      ? await this.messaging.sendPin({ phone: user.phone, pin, staffName: user.name, propertyId: hotel.shortCode })
      : { delivered: false, channel: 'none' as const };

    return { user, pin, delivered: delivery.delivered, channel: delivery.channel };
  }

  async reject(input: { userId: string; note: string; resolvedBy: string }) {
    const user = await this.prisma.user.update({
      where: { id: input.userId },
      data: { approvalStatus: 'rejected', approvalResolvedBy: input.resolvedBy, approvalResolvedAt: new Date(), approvalNote: input.note },
    });
    await this.audit.log({ hotelId: user.hotelId!, eventType: 'STAFF_REJECTED', actorId: input.resolvedBy, subjectId: user.id, detail: { note: input.note } });
    return user;
  }

  async updateProfile(input: {
    userId: string;
    name?: string;
    phone?: string;
    photoPath?: string;
    idNumber?: string;
    idPhotoFrontPath?: string;
    idPhotoBackPath?: string;
    designation?: string;
    shift?: string;
    role?: 'manager' | 'housekeeping';
  }) {
    const { userId, role, ...fields } = input;
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { ...fields, idType: fields.idNumber ? 'aadhaar' : undefined },
    });
    if (role) {
      await this.prisma.userModuleRole.update({ where: { userId_module: { userId, module: 'pms' } }, data: { role } });
      if (role === 'manager' && user.hotelId) {
        await this.grantChannelManagerRoleIfApplicable(user.hotelId, user.organizationId, userId);
      }
    }
    return user;
  }

  /** Owner-only — soft-delete. Revokes login immediately (clears the PIN) and frees that PIN up
   * for someone else at the same hotel; cleaning records/audit log entries keep pointing at this
   * id (nothing cascades), so history doesn't go blank. */
  async remove(input: { userId: string; removedBy: string }) {
    const user = await this.prisma.user.update({ where: { id: input.userId }, data: { active: false, pinHash: null } });
    if (user.hotelId) {
      await this.audit.log({ hotelId: user.hotelId, eventType: 'STAFF_REMOVED', actorId: input.removedBy, subjectId: user.id });
    }
    return user;
  }

  /** Owner-only — mints or resets a staff member's PIN. Refuses to PIN an unapproved profile:
   * approval is the gate that actually lets someone log in, not just having a PIN. */
  async setPin(input: { userId: string; pin: string; setBy: string }) {
    if (!/^\d{4}$/.test(input.pin)) throw new ConflictException('PIN must be exactly 4 digits');

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: input.userId } });
    if (user.approvalStatus !== 'approved') {
      throw new ForbiddenException('Approve this profile before setting a PIN');
    }
    if (!user.hotelId) throw new ConflictException('Staff member has no hotel assigned');

    const existingPins = await this.prisma.user.findMany({
      where: { hotelId: user.hotelId, pinHash: { not: null }, active: true, id: { not: input.userId } },
      select: { pinHash: true },
    });
    for (const { pinHash } of existingPins) {
      if (pinHash && (await bcrypt.compare(input.pin, pinHash))) {
        throw new ConflictException('That PIN is already in use at this hotel — PINs must be unique per hotel');
      }
    }

    const pinHash = await bcrypt.hash(input.pin, 10);
    const updated = await this.prisma.user.update({ where: { id: input.userId }, data: { pinHash } });
    await this.audit.log({ hotelId: user.hotelId, eventType: 'STAFF_PIN_SET', actorId: input.setBy, subjectId: user.id });
    return updated;
  }
}
