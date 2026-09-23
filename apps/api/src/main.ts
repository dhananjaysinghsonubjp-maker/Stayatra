import { NestFactory } from '@nestjs/core';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { AppModule } from './app.module.js';
import { PrismaService } from './prisma/prisma.service.js';
import { AuthService } from './auth/auth.service.js';
import { HotelsService } from './hotels/hotels.service.js';
import { RatesService } from './rates/rates.service.js';
import { BookingsService } from './bookings/bookings.service.js';
import { CleaningService } from './cleaning/cleaning.service.js';
import { OtaService } from './ota/ota.service.js';
import { OtaSyncService } from './sync/ota-sync.service.js';
import { ReportsService } from './reports/reports.service.js';
import { createAppRouter } from './trpc/app.router.js';
import { createContextFactory } from './trpc/context.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const prisma = app.get(PrismaService);
  const auth = app.get(AuthService);
  const appRouter = createAppRouter({
    auth,
    hotels: app.get(HotelsService),
    rates: app.get(RatesService),
    bookings: app.get(BookingsService),
    cleaning: app.get(CleaningService),
    ota: app.get(OtaService),
    sync: app.get(OtaSyncService),
    reports: app.get(ReportsService),
  });

  app.use(
    '/trpc',
    createExpressMiddleware({
      router: appRouter,
      createContext: createContextFactory(prisma, auth),
    }),
  );

  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
