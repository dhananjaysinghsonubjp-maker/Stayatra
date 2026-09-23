import { Module } from '@nestjs/common';
import { ReportsService } from './reports.service.js';

@Module({
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
