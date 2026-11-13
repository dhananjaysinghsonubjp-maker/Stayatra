import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service.js';
import { ErrorLogService } from './error-log.service.js';

@Global()
@Module({
  providers: [AuditService, ErrorLogService],
  exports: [AuditService, ErrorLogService],
})
export class CommonModule {}
