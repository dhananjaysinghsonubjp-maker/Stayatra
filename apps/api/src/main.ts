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
import { CleaningService } from './cleaning/cleaning.service.js';
import { OtaService } from './ota/ota.service.js';
import { OtaSyncService } from './sync/ota-sync.service.js';
import { ReportsService } from './reports/reports.service.js';
import { GuestsService } from './guests/guests.service.js';
import { createAppRouter } from './trpc/app.router.js';
import { createContextFactory } from './trpc/context.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useStaticAssets(path.resolve(process.cwd(), 'uploads'), { prefix: '/uploads/' });

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
    guests: app.get(GuestsService),
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
