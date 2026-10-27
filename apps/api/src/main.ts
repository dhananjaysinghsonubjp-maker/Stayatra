import { NestFactory } from '@nestjs/core';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import path from 'node:path';
import { AppModule } from './app.module.js';
import { PrismaService } from './prisma/prisma.service.js';
import { AuthService } from './auth/auth.service.js';
import { HotelsService } from './hotels/hotels.service.js';
import { RatesService } from './rates/rates.service.js';
import { BookingsService } from './bookings/bookings.service.js';
import { GuestMessagingService } from './guest-messaging/guest-messaging.service.js';
import { ReviewsService } from './reviews/reviews.service.js';
import { CleaningService } from './cleaning/cleaning.service.js';
import { OtaService } from './ota/ota.service.js';
import { OtaSyncService } from './sync/ota-sync.service.js';
import { ReportsService } from './reports/reports.service.js';
import { GuestsService } from './guests/guests.service.js';
import { PlatformAdminService } from './platform-admin/platform-admin.service.js';
import { AffiliateService } from './platform-admin/affiliate.service.js';
import { PlansService } from './plans/plans.service.js';
import { NotificationsService } from './notifications/notifications.service.js';
import { AuditService } from './common/audit.service.js';
import { LedgerService } from './ledger/ledger.service.js';
import { StaffService } from './staff/staff.service.js';
import { ContactsService } from './contacts/contacts.service.js';
import { createAppRouter } from './trpc/app.router.js';
import { createContextFactory } from './trpc/context.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // §deploy — frontend and backend used to always share one origin; splitting them across two
  // hosts (e.g. Vercel + Railway) means the browser now sends cross-origin requests, which the
  // default same-origin policy blocks without this. CORS_ORIGIN is a comma-separated allowlist
  // (e.g. "https://your-app.vercel.app"); unset, it allows any origin — fine for a quick test
  // deploy, tighten to the real frontend URL once this isn't just a UI preview.
  const corsOrigin = process.env.CORS_ORIGIN?.split(',').map((o) => o.trim());
  app.enableCors({ origin: corsOrigin ?? true, credentials: true });
  app.useStaticAssets(path.resolve(process.cwd(), 'uploads'), { prefix: '/uploads/' });

  const prisma = app.get(PrismaService);
  const auth = app.get(AuthService);
  const platformAdmin = app.get(PlatformAdminService);
  const affiliate = app.get(AffiliateService);
  const plans = app.get(PlansService);
  await plans.seedDefaults();
  const appRouter = createAppRouter({
    auth,
    hotels: app.get(HotelsService),
    rates: app.get(RatesService),
    bookings: app.get(BookingsService),
    guestMessaging: app.get(GuestMessagingService),
    reviews: app.get(ReviewsService),
    cleaning: app.get(CleaningService),
    ota: app.get(OtaService),
    sync: app.get(OtaSyncService),
    reports: app.get(ReportsService),
    guests: app.get(GuestsService),
    platformAdmin,
    affiliate,
    plans,
    notifications: app.get(NotificationsService),
    audit: app.get(AuditService),
    ledger: app.get(LedgerService),
    staff: app.get(StaffService),
    contacts: app.get(ContactsService),
  });

  app.use(
    '/trpc',
    createExpressMiddleware({
      router: appRouter,
      createContext: createContextFactory(prisma, auth, platformAdmin, affiliate),
    }),
  );

  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
