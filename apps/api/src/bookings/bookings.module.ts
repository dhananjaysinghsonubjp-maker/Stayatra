import { Module } from '@nestjs/common';
import { BookingsService } from './bookings.service.js';
import { GuestsModule } from '../guests/guests.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { RatesModule } from '../rates/rates.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';

@Module({
  imports: [GuestsModule, NotificationsModule, RatesModule, LedgerModule],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}
