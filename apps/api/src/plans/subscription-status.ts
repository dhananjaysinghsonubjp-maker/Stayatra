import { SubscriptionStatus } from '@prisma/client';

// §5.4's open decision #6 — 3 days is a placeholder, not yet admin-tunable (no
// billing_settings CRUD built). Change this one constant when a real number is confirmed.
export const GRACE_PERIOD_DAYS = 3;
const TRIAL_STATUSES: SubscriptionStatus[] = ['trialing'];

export interface AccessResult {
  /** What the client should actually treat the org as right now — not necessarily the stored `status`, which only changes when something writes to it (signup, a future renewal webhook). This is computed fresh from dates on every request instead of needing a cron job to flip it. */
  effectiveStatus: SubscriptionStatus;
  /** Mutations are rejected once this is true (§5.4's "reject any write with 402") — reads always stay open so the owner can still see their data and the Billing page while locked. */
  locked: boolean;
  /** Only meaningful while still on trial with no paid period active yet. */
  daysLeftInTrial: number | null;
}

/**
 * Pure, computed at read time (same principle as this codebase's GST slabs and derived rates) —
 * no scheduled job flips `trialing` → `past_due` → `locked` in the background; every request just
 * asks "given these dates and today, what should this org's access be right now?"
 *
 * Anchor date: `trialEndsAt` while still trialing (nothing paid yet), else `currentPeriodEnd` (the
 * paid period this org bought or renewed into). Past the anchor, `GRACE_PERIOD_DAYS` of full access
 * still applies (§5.4's "full access continues" during past_due) before mutations get rejected.
 */
export function resolveSubscriptionAccess(
  sub: { status: SubscriptionStatus; trialEndsAt: Date | null; currentPeriodEnd: Date },
  now: Date = new Date(),
): AccessResult {
  if (sub.status === 'cancelled') {
    return { effectiveStatus: 'locked', locked: true, daysLeftInTrial: null };
  }

  const onTrial = TRIAL_STATUSES.includes(sub.status) && sub.trialEndsAt != null;
  const anchor = onTrial ? sub.trialEndsAt! : sub.currentPeriodEnd;
  const graceEnd = new Date(anchor.getTime() + GRACE_PERIOD_DAYS * 86400000);

  if (now <= anchor) {
    const daysLeftInTrial = onTrial ? Math.max(0, Math.ceil((anchor.getTime() - now.getTime()) / 86400000)) : null;
    return { effectiveStatus: onTrial ? 'trialing' : 'active', locked: false, daysLeftInTrial };
  }
  if (now <= graceEnd) {
    return { effectiveStatus: 'past_due', locked: false, daysLeftInTrial: null };
  }
  return { effectiveStatus: 'locked', locked: true, daysLeftInTrial: null };
}
