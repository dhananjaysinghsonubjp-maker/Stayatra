export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

export interface PaymentGatewaySubscriptionResult {
  gatewayReference: string | null;
  /** Whether the charge succeeded well enough to activate the subscription right now. */
  active: boolean;
}

/**
 * Swappable the same way IdExtractor is (see id-extraction/) — StubPaymentGateway
 * is the only implementation today (no Razorpay/PayU credentials exist yet).
 * Wiring in a real gateway later means: write a class implementing this
 * interface, then swap the factory condition in plans.module.ts the same way
 * id-extraction.module.ts picks AnthropicIdExtractor once ANTHROPIC_API_KEY exists.
 */
export interface PaymentGateway {
  createSubscription(input: { organizationId: string; planKey: string; priceMonthly: number }): Promise<PaymentGatewaySubscriptionResult>;
}
