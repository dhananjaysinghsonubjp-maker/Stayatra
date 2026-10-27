import { router, publicProcedure } from './trpc.js';
import { createAuthRouter } from '../auth/auth.router.js';
import { createHotelsRouter } from '../hotels/hotels.router.js';
import { createRatesRouter } from '../rates/rates.router.js';
import { createBookingsRouter } from '../bookings/bookings.router.js';
import { createGuestMessagingRouter } from '../guest-messaging/guest-messaging.router.js';
import { createReviewsRouter } from '../reviews/reviews.router.js';
import { createCleaningRouter } from '../cleaning/cleaning.router.js';
import { createOtaRouter } from '../ota/ota.router.js';
import { createReportsRouter } from '../reports/reports.router.js';
import { createGuestsRouter } from '../guests/guests.router.js';
import { createPlatformAdminRouter } from '../platform-admin/platform-admin.router.js';
import { createAffiliateRouter } from '../platform-admin/affiliate.router.js';
import { createPlansRouter } from '../plans/plans.router.js';
import { createBillingRouter } from '../plans/billing.router.js';
import { createNotificationsRouter } from '../notifications/notifications.router.js';
import { createAuditRouter } from '../common/audit.router.js';
import { createLedgerRouter } from '../ledger/ledger.router.js';
import { createStaffRouter } from '../staff/staff.router.js';
import { createContactsRouter } from '../contacts/contacts.router.js';
import type { AuthService } from '../auth/auth.service.js';
import type { HotelsService } from '../hotels/hotels.service.js';
import type { RatesService } from '../rates/rates.service.js';
import type { BookingsService } from '../bookings/bookings.service.js';
import type { GuestMessagingService } from '../guest-messaging/guest-messaging.service.js';
import type { ReviewsService } from '../reviews/reviews.service.js';
import type { CleaningService } from '../cleaning/cleaning.service.js';
import type { OtaService } from '../ota/ota.service.js';
import type { OtaSyncService } from '../sync/ota-sync.service.js';
import type { ReportsService } from '../reports/reports.service.js';
import type { GuestsService } from '../guests/guests.service.js';
import type { PlatformAdminService } from '../platform-admin/platform-admin.service.js';
import type { AffiliateService } from '../platform-admin/affiliate.service.js';
import type { PlansService } from '../plans/plans.service.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { AuditService } from '../common/audit.service.js';
import type { LedgerService } from '../ledger/ledger.service.js';
import type { StaffService } from '../staff/staff.service.js';
import type { ContactsService } from '../contacts/contacts.service.js';

export function createAppRouter(services: {
  auth: AuthService;
  hotels: HotelsService;
  rates: RatesService;
  bookings: BookingsService;
  guestMessaging: GuestMessagingService;
  reviews: ReviewsService;
  cleaning: CleaningService;
  ota: OtaService;
  sync: OtaSyncService;
  reports: ReportsService;
  guests: GuestsService;
  platformAdmin: PlatformAdminService;
  affiliate: AffiliateService;
  plans: PlansService;
  notifications: NotificationsService;
  audit: AuditService;
  ledger: LedgerService;
  staff: StaffService;
  contacts: ContactsService;
}) {
  return router({
    health: router({
      check: publicProcedure.query(async ({ ctx }) => {
        await ctx.prisma.$queryRaw`SELECT 1`;
        return { status: 'ok', db: 'connected' };
      }),
    }),
    auth: createAuthRouter(services.auth),
    hotels: createHotelsRouter(services.hotels),
    rates: createRatesRouter(services.rates, services.sync),
    bookings: createBookingsRouter(services.bookings),
    guestMessaging: createGuestMessagingRouter(services.guestMessaging),
    reviews: createReviewsRouter(services.reviews),
    cleaning: createCleaningRouter(services.cleaning),
    ota: createOtaRouter(services.ota, services.sync),
    reports: createReportsRouter(services.reports),
    guests: createGuestsRouter(services.guests),
    platformAdmin: createPlatformAdminRouter(services.platformAdmin),
    affiliate: createAffiliateRouter(services.affiliate),
    plans: createPlansRouter(services.plans),
    billing: createBillingRouter(services.plans),
    notifications: createNotificationsRouter(services.notifications),
    audit: createAuditRouter(services.audit),
    ledger: createLedgerRouter(services.ledger),
    staff: createStaffRouter(services.staff),
    contacts: createContactsRouter(services.contacts),
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;
