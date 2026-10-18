import { Module } from '@nestjs/common';
import { GuestMessagingService } from './guest-messaging.service.js';

@Module({
  providers: [GuestMessagingService],
  exports: [GuestMessagingService],
})
export class GuestMessagingModule {}
