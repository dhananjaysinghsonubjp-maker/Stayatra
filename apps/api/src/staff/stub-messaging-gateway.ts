import { Injectable } from '@nestjs/common';
import type { MessagingGateway, MessagingGatewayResult } from './messaging-gateway.interface.js';

/** No real WhatsApp/SMS gateway wired up yet — never actually sends anything. Clearly labeled,
 * same spirit as StubPaymentGateway/StubIdExtractor. */
@Injectable()
export class StubMessagingGateway implements MessagingGateway {
  async sendPin(): Promise<MessagingGatewayResult> {
    return { delivered: false, channel: 'none' };
  }
}
