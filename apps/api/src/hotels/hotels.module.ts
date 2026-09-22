import { Module } from '@nestjs/common';
import { HotelsService } from './hotels.service.js';

@Module({
  providers: [HotelsService],
  exports: [HotelsService],
})
export class HotelsModule {}
