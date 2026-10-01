import { Injectable } from '@nestjs/common';
import type { PaymentGateway, PaymentGatewaySubscriptionResult } from './payment-gateway.interface.js';

/** No real charge happens — "buying" a plan activates it immediately. Clearly labeled, same spirit as StubIdExtractor. */
@Injectable()
export class StubPaymentGateway implements PaymentGateway {
  async createSubscription(): Promise<PaymentGatewaySubscriptionResult> {
    return { gatewayReference: null, active: true };
  }
}
