import { Module } from '@nestjs/common';
import { StaffService } from './staff.service.js';
import { NotificationsModule } from '../notifications/notifications.module.js';

@Module({
  imports: [NotificationsModule],
  providers: [StaffService],
  exports: [StaffService],
})
export class StaffModule {}
