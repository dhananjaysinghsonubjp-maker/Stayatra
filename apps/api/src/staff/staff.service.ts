import { Injectable, ConflictException, ForbiddenException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../common/audit.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';

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
  ) {}

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
    idPhotoPath?: string;
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
        idPhotoPath: input.idPhotoPath,
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
        link: 'settings_staff',
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
        idPhotoPath: u.idPhotoPath,
        approvalStatus: u.approvalStatus,
        approvalNote: u.approvalNote,
        hasPinSet: Boolean(u.pinHash),
        createdAt: u.createdAt,
      }));
  }

  async approve(input: { userId: string; resolvedBy: string }) {
    const user = await this.prisma.user.update({
      where: { id: input.userId },
      data: { approvalStatus: 'approved', approvalResolvedBy: input.resolvedBy, approvalResolvedAt: new Date(), approvalNote: null },
    });
    await this.audit.log({ hotelId: user.hotelId!, eventType: 'STAFF_APPROVED', actorId: input.resolvedBy, subjectId: user.id });
    return user;
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
    idPhotoPath?: string;
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
