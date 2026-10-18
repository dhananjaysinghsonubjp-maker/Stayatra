/**
 * Help Desk widget's roster (§ user request — matching a reference product's "Help Center"
 * popover). Left empty on purpose: the reference screenshot's names (Pratik Verma, Ajeet,
 * Anchal, Aishwary) belong to that other product, not this one, so they were never used here.
 * Fill this in with the real support team once those details are shared, in the same shape:
 *   { id: 'owner', role: 'Owner', name: 'Full Name', phone: '+91XXXXXXXXXX', email: 'a@b.com' }
 */
export interface SupportContact {
  id: string;
  role: string;
  name: string;
  phone?: string;
  email?: string;
}

export const SUPPORT_CONTACTS: SupportContact[] = [];
