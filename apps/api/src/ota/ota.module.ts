import { Module } from '@nestjs/common';
import { OtaService } from './ota.service.js';
import { CredentialVaultService } from './credential-vault.service.js';

@Module({
  providers: [OtaService, CredentialVaultService],
  exports: [OtaService, CredentialVaultService],
})
export class OtaModule {}
