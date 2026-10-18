import { Module } from '@nestjs/common';
import { CleaningService } from './cleaning.service.js';
import { NotificationsModule } from '../notifications/notifications.module.js';

@Module({
  imports: [NotificationsModule],
  providers: [CleaningService],
  exports: [CleaningService],
})
export class CleaningModule {}
