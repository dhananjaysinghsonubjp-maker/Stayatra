import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { CommonModule } from './common/common.module.js';
import { AuthModule } from './auth/auth.module.js';
import { HotelsModule } from './hotels/hotels.module.js';
import { RatesModule } from './rates/rates.module.js';
import { BookingsModule } from './bookings/bookings.module.js';
import { CleaningModule } from './cleaning/cleaning.module.js';
import { OtaModule } from './ota/ota.module.js';
import { SyncModule } from './sync/sync.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { GuestsModule } from './guests/guests.module.js';
import { IdExtractionModule } from './id-extraction/id-extraction.module.js';
import { UploadsController } from './id-extraction/uploads.controller.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    CommonModule,
    AuthModule,
    HotelsModule,
    RatesModule,
    BookingsModule,
    CleaningModule,
    OtaModule,
    SyncModule,
    ReportsModule,
    GuestsModule,
    IdExtractionModule,
  ],
  controllers: [AppController, UploadsController],
  providers: [AppService],
})
export class AppModule {}
