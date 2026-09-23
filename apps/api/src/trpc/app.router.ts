import { router, publicProcedure } from './trpc.js';
import { createAuthRouter } from '../auth/auth.router.js';
import { createHotelsRouter } from '../hotels/hotels.router.js';
import { createRatesRouter } from '../rates/rates.router.js';
import { createBookingsRouter } from '../bookings/bookings.router.js';
import { createCleaningRouter } from '../cleaning/cleaning.router.js';
import { createOtaRouter } from '../ota/ota.router.js';
import { createReportsRouter } from '../reports/reports.router.js';
import { createGuestsRouter } from '../guests/guests.router.js';
import type { AuthService } from '../auth/auth.service.js';
import type { HotelsService } from '../hotels/hotels.service.js';
import type { RatesService } from '../rates/rates.service.js';
import type { BookingsService } from '../bookings/bookings.service.js';
import type { CleaningService } from '../cleaning/cleaning.service.js';
import type { OtaService } from '../ota/ota.service.js';
import type { OtaSyncService } from '../sync/ota-sync.service.js';
import type { ReportsService } from '../reports/reports.service.js';
import type { GuestsService } from '../guests/guests.service.js';

export function createAppRouter(services: {
  auth: AuthService;
  hotels: HotelsService;
  rates: RatesService;
  bookings: BookingsService;
  cleaning: CleaningService;
  ota: OtaService;
  sync: OtaSyncService;
  reports: ReportsService;
  guests: GuestsService;
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
    cleaning: createCleaningRouter(services.cleaning),
    ota: createOtaRouter(services.ota, services.sync),
    reports: createReportsRouter(services.reports),
    guests: createGuestsRouter(services.guests),
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;
