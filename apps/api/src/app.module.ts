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
import { GuestMessagingModule } from './guest-messaging/guest-messaging.module.js';
import { ReviewsModule } from './reviews/reviews.module.js';
import { CleaningModule } from './cleaning/cleaning.module.js';
import { OtaModule } from './ota/ota.module.js';
import { SyncModule } from './sync/sync.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { GuestsModule } from './guests/guests.module.js';
import { IdExtractionModule } from './id-extraction/id-extraction.module.js';
import { UploadsController } from './id-extraction/uploads.controller.js';
import { PlatformAdminModule } from './platform-admin/platform-admin.module.js';
import { PlansModule } from './plans/plans.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { LedgerModule } from './ledger/ledger.module.js';
import { StaffModule } from './staff/staff.module.js';
import { ContactsModule } from './contacts/contacts.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    CommonModule,
    PlansModule,
    NotificationsModule,
    AuthModule,
    HotelsModule,
    RatesModule,
    BookingsModule,
    GuestMessagingModule,
    ReviewsModule,
    CleaningModule,
    OtaModule,
    SyncModule,
    ReportsModule,
    GuestsModule,
    IdExtractionModule,
    PlatformAdminModule,
    LedgerModule,
    StaffModule,
    ContactsModule,
  ],
  controllers: [AppController, UploadsController],
  providers: [AppService],
})
export class AppModule {}
