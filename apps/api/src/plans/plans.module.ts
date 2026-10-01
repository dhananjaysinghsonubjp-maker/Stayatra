import { Global, Module } from '@nestjs/common';
import { PlansService } from './plans.service.js';
import { PAYMENT_GATEWAY } from './payment-gateway.interface.js';
import { StubPaymentGateway } from './stub-payment-gateway.js';

@Global()
@Module({
  providers: [PlansService, { provide: PAYMENT_GATEWAY, useClass: StubPaymentGateway }],
  exports: [PlansService, PAYMENT_GATEWAY],
})
export class PlansModule {}
