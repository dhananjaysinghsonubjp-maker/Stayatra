import { Module } from '@nestjs/common';
import { BookingsService } from './bookings.service.js';
import { GuestsModule } from '../guests/guests.module.js';

@Module({
  imports: [GuestsModule],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}
