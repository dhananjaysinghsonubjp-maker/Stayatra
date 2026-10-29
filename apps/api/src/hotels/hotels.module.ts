import { Module } from '@nestjs/common';
import { HotelsService } from './hotels.service.js';
import { RatesModule } from '../rates/rates.module.js';

@Module({
  imports: [RatesModule],
  providers: [HotelsService],
  exports: [HotelsService],
})
export class HotelsModule {}
