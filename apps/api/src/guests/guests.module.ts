import { Module } from '@nestjs/common';
import { GuestsService } from './guests.service.js';

@Module({
  providers: [GuestsService],
  exports: [GuestsService],
})
export class GuestsModule {}
