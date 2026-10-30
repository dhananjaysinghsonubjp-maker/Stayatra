import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { authedProcedure, router, requireRole } from '../trpc/trpc.js';
import type { HotelsService } from './hotels.service.js';

const ownerOrManager = requireRole('pms', ['owner', 'manager']);
const frontDeskUp = requireRole('pms', ['owner', 'manager', 'front_desk']);

/**
 * `Hotel` and `RoomCategory` are shared by both modules (§5.1/§5.3 — a
 * Channel-Manager-only org still needs a property to scope room categories/
 * rate plans/OTA connections to, it just never touches physical `rooms`).
 * Gating hotel/category creation behind PMS alone meant a CM-only plan
 * (§5.4 — added beyond MD spec, every module sold separately) could sign up
 * and then hit FORBIDDEN on step one of onboarding. This accepts owner/manager
 * on either module; the genuinely PMS-only endpoints below (physical rooms,
 * staff PINs) stay on the plain PMS-only guard.
 */
const ownerOrManagerAnyModule = authedProcedure.use(({ ctx, next }) => {
  const pmsRole = ctx.user.roles.pms;
  const cmRole = ctx.user.roles.channel_manager;
  const allowed = ['owner', 'manager'];
  if (!allowed.includes(pmsRole ?? '') && !allowed.includes(cmRole ?? '')) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Requires owner/manager on PMS or Channel Manager' });
  }
  return next();
});

export function createHotelsRouter(hotels: HotelsService) {
  return router({
    create: ownerOrManagerAnyModule
      .input(
        z.object({
          name: z.string().min(1),
          addressLine: z.string().optional(),
          apartmentOrFloor: z.string().optional(),
          city: z.string().optional(),
          state: z.string().optional(),
          pincode: z.string().optional(),
          latitude: z.number().optional(),
          longitude: z.number().optional(),
          gstRegistration: z.string().optional(),
          expectedRoomCount: z.number().int().positive().optional(),
          expectedStaffCount: z.number().int().positive().optional(),
          starRating: z.number().int().min(0).max(5).optional(),
          builtYear: z.number().int().optional(),
          acceptingBookingsSince: z.number().int().optional(),
          contactEmail: z.string().email().optional().or(z.literal('')),
          contactMobile: z.string().optional(),
          contactMobileIsWhatsapp: z.boolean().optional(),
          contactLandline: z.string().optional(),
          dpdpConsent: z.boolean(),
        }),
      )
      .mutation(({ ctx, input }) => hotels.createHotel({ organizationId: ctx.user.organizationId, ...input })),

    updateBasicInfo: ownerOrManagerAnyModule
      .input(
        z.object({
          hotelId: z.string(),
          name: z.string().min(1).optional(),
          starRating: z.number().int().min(0).max(5).nullable().optional(),
          builtYear: z.number().int().nullable().optional(),
          acceptingBookingsSince: z.number().int().nullable().optional(),
          contactEmail: z.string().email().optional().or(z.literal('')),
          contactMobile: z.string().optional(),
          contactMobileIsWhatsapp: z.boolean().optional(),
          contactLandline: z.string().optional(),
        }),
      )
      .mutation(({ input }) => hotels.updateBasicInfo(input)),

    updateAddress: ownerOrManagerAnyModule
      .input(
        z.object({
          hotelId: z.string(),
          addressLine: z.string().optional(),
          apartmentOrFloor: z.string().optional(),
          city: z.string().optional(),
          state: z.string().optional(),
          pincode: z.string().optional(),
          latitude: z.number().nullable().optional(),
          longitude: z.number().nullable().optional(),
        }),
      )
      .mutation(({ input }) => hotels.updateAddress(input)),

    updatePolicies: ownerOrManagerAnyModule
      .input(
        z.object({
          hotelId: z.string(),
          checkInTime: z.string().optional(),
          checkOutTime: z.string().optional(),
          cancellationPolicy: z.enum(['free_till_checkin', 'free_24h', 'free_48h', 'free_72h', 'non_refundable']).optional(),
          allowUnmarriedCouples: z.boolean().optional(),
        }),
      )
      .mutation(({ input }) => hotels.updatePolicies(input)),

    list: authedProcedure.query(({ ctx }) => hotels.listHotels(ctx.user.organizationId)),

    get: authedProcedure.input(z.object({ hotelId: z.string() })).query(({ input }) => hotels.getHotel(input.hotelId)),

    setLogo: ownerOrManagerAnyModule
      .input(z.object({ hotelId: z.string(), filePath: z.string().nullable() }))
      .mutation(({ input }) => hotels.setHotelLogo(input.hotelId, input.filePath)),

    setBrandColor: ownerOrManagerAnyModule
      .input(z.object({ hotelId: z.string(), brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable() }))
      .mutation(({ input }) => hotels.setBrandColor(input.hotelId, input.brandColor)),

    setBannerText: ownerOrManagerAnyModule
      .input(z.object({ hotelId: z.string(), bannerText: z.string().trim().max(60).nullable() }))
      .mutation(({ input }) => hotels.setBannerText(input.hotelId, input.bannerText || null)),

    // Fixed id list ("<family>-<weight>"), kept in sync with FONT_FAMILIES in
    // apps/web/src/fontCatalog.ts — never a free-text font name/CSS value, so there's no way to
    // inject arbitrary font CSS here.
    setFontFamily: ownerOrManagerAnyModule
      .input(
        z.object({
          hotelId: z.string(),
          fontFamily: z
            .enum([
              'arial-400',
              'arial-700',
              'poppins-400',
              'poppins-700',
              'open-sans-400',
              'open-sans-700',
              'montserrat-400',
              'montserrat-700',
              'open-sauce-400',
              'open-sauce-700',
              'cinzel-400',
              'cinzel-700',
            ])
            .nullable(),
        }),
      )
      .mutation(({ input }) => hotels.setFontFamily(input.hotelId, input.fontFamily)),

    updateInvoiceSettings: ownerOrManagerAnyModule
      .input(
        z.object({
          hotelId: z.string(),
          licenseNumber: z.string().trim().max(100).nullish(),
          upiId: z.string().trim().max(100).nullish(),
          invoiceTerms: z.string().trim().max(2000).nullish(),
          showPaymentSummaryOnInvoice: z.boolean().optional(),
          showTermsOnInvoice: z.boolean().optional(),
        }),
      )
      .mutation(({ input: { hotelId, ...rest } }) => hotels.updateInvoiceSettings(hotelId, rest)),

    setInvoiceStamp: ownerOrManagerAnyModule
      .input(z.object({ hotelId: z.string(), filePath: z.string().nullable() }))
      .mutation(({ input }) => hotels.setInvoiceStamp(input.hotelId, input.filePath)),

    createRoomCategory: ownerOrManagerAnyModule
      .input(z.object({ hotelId: z.string(), name: z.string().min(1), description: z.string().optional() }))
      .mutation(({ input }) => hotels.createRoomCategory(input)),

    updateRoomCategory: ownerOrManagerAnyModule
      .input(
        z.object({
          roomCategoryId: z.string(),
          name: z.string().min(1).optional(),
          description: z.string().optional(),
          active: z.boolean().optional(),
          roomType: z.string().optional(),
          roomView: z.string().optional(),
          roomSizeSqft: z.number().int().positive().optional(),
          bedType: z.string().optional(),
          maxOccupancy: z.number().int().positive().optional(),
          bathroomCount: z.number().int().positive().optional(),
          amenities: z.array(z.string()).optional(),
        }),
      )
      .mutation(({ input }) => hotels.updateRoomCategory(input)),

    listRoomCategories: authedProcedure
      .input(z.object({ hotelId: z.string() }))
      .query(({ input }) => hotels.listRoomCategories(input.hotelId)),

    getRoomCategoryDetail: authedProcedure
      .input(z.object({ roomCategoryId: z.string() }))
      .query(({ input }) => hotels.getRoomCategoryDetail(input.roomCategoryId)),

    addRoomPhoto: ownerOrManagerAnyModule
      .input(z.object({ roomCategoryId: z.string(), filePath: z.string() }))
      .mutation(({ input }) => hotels.addRoomPhoto(input)),

    removeRoomPhoto: ownerOrManagerAnyModule
      .input(z.object({ photoId: z.string() }))
      .mutation(({ input }) => hotels.removeRoomPhoto(input.photoId)),

    updateHotelAmenities: ownerOrManagerAnyModule
      .input(z.object({ hotelId: z.string(), amenities: z.array(z.string()) }))
      .mutation(({ input }) => hotels.updateHotelAmenities(input)),

    listHotelPhotos: authedProcedure
      .input(z.object({ hotelId: z.string() }))
      .query(({ input }) => hotels.listHotelPhotos(input.hotelId)),

    addHotelPhoto: ownerOrManagerAnyModule
      .input(z.object({ hotelId: z.string(), filePath: z.string() }))
      .mutation(({ input }) => hotels.addHotelPhoto(input)),

    removeHotelPhoto: ownerOrManagerAnyModule
      .input(z.object({ photoId: z.string() }))
      .mutation(({ input }) => hotels.removeHotelPhoto(input.photoId)),

    updateFinance: ownerOrManagerAnyModule
      .input(
        z.object({
          hotelId: z.string(),
          gstRegistration: z.string().optional(),
          panNumber: z.string().optional(),
          bankAccountHolderName: z.string().optional(),
          bankAccountNumber: z.string().optional(),
          bankIfsc: z.string().optional(),
        }),
      )
      .mutation(({ input }) => hotels.updateFinance(input)),

    generatePlaceholderRooms: ownerOrManager
      .input(z.object({ hotelId: z.string(), count: z.number().int().positive(), roomCategoryId: z.string().optional() }))
      .mutation(({ input }) => hotels.generatePlaceholderRooms(input)),

    assignRoomCategory: ownerOrManager
      .input(z.object({ roomId: z.string(), roomCategoryId: z.string().nullable() }))
      .mutation(({ input }) => hotels.assignRoomCategory(input)),

    renameRoom: ownerOrManager
      .input(z.object({ roomId: z.string(), roomNumber: z.string().min(1) }))
      .mutation(({ input }) => hotels.renameRoom(input)),

    addRoom: ownerOrManager
      .input(z.object({ hotelId: z.string(), roomNumber: z.string().min(1), roomCategoryId: z.string().nullable().optional() }))
      .mutation(({ input }) => hotels.addRoom(input)),

    deleteRoom: ownerOrManager.input(z.object({ roomId: z.string() })).mutation(({ input }) => hotels.deleteRoom(input)),

    listRooms: authedProcedure.input(z.object({ hotelId: z.string() })).query(({ input }) => hotels.listRooms(input.hotelId)),

    listStaff: ownerOrManager.input(z.object({ hotelId: z.string() })).query(({ input }) => hotels.listStaff(input.hotelId)),

    // §user request, matching a reference app's Calendar empty-cell "Add Maintenance Block" panel.
    checkRoomAvailability: frontDeskUp
      .input(z.object({ roomId: z.string(), startAt: z.coerce.date(), endAt: z.coerce.date(), excludeMaintenanceBlockId: z.string().optional() }))
      .query(({ input }) => hotels.checkRoomAvailability(input)),

    createMaintenanceBlock: frontDeskUp
      .input(z.object({ hotelId: z.string(), roomId: z.string(), startAt: z.coerce.date(), endAt: z.coerce.date(), reason: z.string().optional() }))
      .mutation(({ ctx, input }) => hotels.createMaintenanceBlock({ ...input, actorId: ctx.user.userId })),

    updateMaintenanceBlock: frontDeskUp
      .input(z.object({ maintenanceBlockId: z.string(), startAt: z.coerce.date(), endAt: z.coerce.date(), reason: z.string().optional() }))
      .mutation(({ ctx, input }) => hotels.updateMaintenanceBlock({ ...input, actorId: ctx.user.userId })),

    releaseMaintenanceBlock: frontDeskUp
      .input(z.object({ maintenanceBlockId: z.string() }))
      .mutation(({ ctx, input }) => hotels.releaseMaintenanceBlock({ ...input, actorId: ctx.user.userId })),

    listMaintenanceBlocks: authedProcedure
      .input(z.object({ hotelId: z.string(), from: z.coerce.date(), to: z.coerce.date() }))
      .query(({ input }) => hotels.listMaintenanceBlocks(input)),
  });
}
