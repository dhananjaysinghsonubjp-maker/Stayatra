import { Global, Module } from '@nestjs/common';
import { PlatformAdminService } from './platform-admin.service.js';
import { AffiliateService } from './affiliate.service.js';

@Global()
@Module({
  providers: [PlatformAdminService, AffiliateService],
  exports: [PlatformAdminService, AffiliateService],
})
export class PlatformAdminModule {}
