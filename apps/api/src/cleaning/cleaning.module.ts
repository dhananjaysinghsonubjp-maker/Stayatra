import { Module } from '@nestjs/common';
import { CleaningService } from './cleaning.service.js';

@Module({
  providers: [CleaningService],
  exports: [CleaningService],
})
export class CleaningModule {}
