import { Module } from '@nestjs/common';
import { OtaService } from './ota.service.js';

@Module({
  providers: [OtaService],
  exports: [OtaService],
})
export class OtaModule {}
