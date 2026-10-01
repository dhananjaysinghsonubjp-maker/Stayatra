import { Module } from '@nestjs/common';
import { BookingsService } from './bookings.service.js';
import { GuestsModule } from '../guests/guests.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { RatesModule } from '../rates/rates.module.js';

@Module({
  imports: [GuestsModule, NotificationsModule, RatesModule],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}
