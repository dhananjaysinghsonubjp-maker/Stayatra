import { useEffect, useState } from 'react';
import { query } from '../api';
import { useAuth } from '../AuthContext';

interface Status {
  effectiveStatus: 'trialing' | 'active' | 'past_due' | 'locked' | 'cancelled';
  daysLeftInTrial: number | null;
}

/** §5.4: "every client shows a Renew Subscription banner throughout past_due" — same read every
 * client would show, one place it's implemented. Silent once a plan is comfortably active. */
export function SubscriptionBanner({ onViewBilling }: { onViewBilling: () => void }) {
  const { token } = useAuth();
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const s = await query<Status>('billing.getStatus', undefined, token ?? undefined);
        if (!cancelled) setStatus(s);
      } catch {
        // billing.getStatus is owner-scoped data only via the org's own subscription — if this
        // ever errors (e.g. no subscription row on old test data), just stay silent, not broken.
      }
    }
    void load();
    const id = setInterval(load, 60000);
    // Billing.tsx fires this right after a renewal so this banner doesn't keep showing "overdue"
    // for up to a minute waiting on its own poll.
    window.addEventListener('subscription-updated', load);
    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener('subscription-updated', load);
    };
  }, [token]);

  if (!status || status.effectiveStatus === 'active') return null;

  const isTrial = status.effectiveStatus === 'trialing';
  const isLocked = status.effectiveStatus === 'locked' || status.effectiveStatus === 'cancelled';
  const tone = isLocked
    ? 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400'
    : isTrial
      ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-400'
      : 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400';

  const message = isLocked
    ? 'Your subscription has lapsed — changes are blocked until you renew.'
    : isTrial
      ? `${status.daysLeftInTrial} day${status.daysLeftInTrial === 1 ? '' : 's'} left in your free trial.`
      : 'Your payment is overdue — renew soon to avoid losing access.';

  return (
    <div className={`flex items-center justify-between px-8 py-2 text-xs font-medium ${tone}`}>
      <span>{message}</span>
      <button onClick={onViewBilling} className="font-semibold hover:underline">
        {isLocked || !isTrial ? 'Renew now →' : 'View plan →'}
      </button>
    </div>
  );
}
