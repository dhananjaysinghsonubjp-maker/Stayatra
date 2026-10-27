import { Module } from '@nestjs/common';
import { StaffService } from './staff.service.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { MESSAGING_GATEWAY } from './messaging-gateway.interface.js';
import { StubMessagingGateway } from './stub-messaging-gateway.js';

@Module({
  imports: [NotificationsModule],
  providers: [StaffService, { provide: MESSAGING_GATEWAY, useClass: StubMessagingGateway }],
  exports: [StaffService],
})
export class StaffModule {}
