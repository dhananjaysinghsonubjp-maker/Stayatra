import { Module } from '@nestjs/common';
import { MasterDataService } from './master-data.service.js';

@Module({
  providers: [MasterDataService],
  exports: [MasterDataService],
})
export class MasterDataModule {}
