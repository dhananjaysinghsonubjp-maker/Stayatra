export const MESSAGING_GATEWAY = Symbol('MESSAGING_GATEWAY');

export interface MessagingGatewayResult {
  delivered: boolean;
  channel: 'whatsapp' | 'sms' | 'none';
}

/**
 * §user request — "jab FMO ka proposed staff owner approve karta hai, automatically 4-digit PIN
 * generate ho aur WhatsApp pe chala jaaye, nahi toh SMS pe": no WhatsApp Business API / SMS
 * gateway credentials exist yet, so this can't actually deliver anything today — same swap-later
 * shape as PaymentGateway/IdExtractor. StaffService.approve() still generates and sets the real
 * PIN regardless of what this returns; `delivered: false` from the stub is what tells the owner
 * "share this PIN yourself for now" instead of silently pretending it went out.
 *
 * Wiring in a real channel later: write a class implementing this (try WhatsApp first, fall back
 * to SMS on failure — mirrors the user's own "WhatsApp nahi toh SMS" requirement), then swap the
 * factory in staff.module.ts the same way plans.module.ts picks a real PaymentGateway once
 * credentials exist.
 */
export interface MessagingGateway {
  sendPin(input: { phone: string; pin: string; staffName: string; propertyId: string }): Promise<MessagingGatewayResult>;
}
