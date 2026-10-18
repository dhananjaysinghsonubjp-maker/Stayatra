import { useEffect, useState } from 'react';
import { mutate, query, ApiError } from '../api';
import { useAuth } from '../AuthContext';
import { Badge, Button, Card, CardBody, CardHeader, PageHeader } from '../components/ui';

interface SubscriptionStatus {
  planName: string;
  priceMonthly: string;
  status: 'trialing' | 'active' | 'past_due' | 'locked' | 'cancelled';
  effectiveStatus: 'trialing' | 'active' | 'past_due' | 'locked' | 'cancelled';
  locked: boolean;
  daysLeftInTrial: number | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string;
  enabledModules: string[];
}

const MODULE_LABEL: Record<string, string> = {
  pms: 'PMS (Front Desk, Room View, Housekeeping)',
  channel_manager: 'Channel Manager (OTA distribution)',
  theft_protection: 'Theft Protection',
};

const STATUS_COPY: Record<SubscriptionStatus['effectiveStatus'], { tone: string; label: string }> = {
  trialing: { tone: 'confirmed', label: 'Free trial' },
  active: { tone: 'available', label: 'Active' },
  past_due: { tone: 'occupied', label: 'Payment overdue' },
  locked: { tone: 'flagged', label: 'Locked' },
  cancelled: { tone: 'flagged', label: 'Cancelled' },
};

export function Billing() {
  const { token } = useAuth();
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renewing, setRenewing] = useState(false);

  async function refresh() {
    try {
      const s = await query<SubscriptionStatus>('billing.getStatus', undefined, token ?? undefined);
      setStatus(s);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load subscription status');
    }
  }
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function renew() {
    setRenewing(true);
    setError(null);
    try {
      await mutate('billing.simulateRenewal', undefined, token ?? undefined);
      await refresh();
      // The top banner (SubscriptionBanner) polls independently on its own 60s timer — without
      // this it'd keep showing "overdue" for up to a minute after a renewal just fixed it.
      window.dispatchEvent(new Event('subscription-updated'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Renewal failed');
    } finally {
      setRenewing(false);
    }
  }

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!status) return <p className="text-sm text-slate-400">Loading…</p>;

  const copy = STATUS_COPY[status.effectiveStatus];

  return (
    <div>
      <PageHeader title="Billing" subtitle="Your plan and subscription status." />

      <Card className="mb-6">
        <CardHeader title={status.planName} subtitle={`₹${Number(status.priceMonthly).toLocaleString('en-IN')}/month`} action={<Badge tone={copy.tone}>{copy.label}</Badge>} />
        <CardBody>
          {status.effectiveStatus === 'trialing' && (
            <p className="text-sm text-slate-600">
              {status.daysLeftInTrial} day{status.daysLeftInTrial === 1 ? '' : 's'} left in your free trial. No payment gateway is
              connected yet — the button below simulates a renewal so this flow can be tested end to end.
            </p>
          )}
          {status.effectiveStatus === 'active' && (
            <p className="text-sm text-slate-600">Paid through {status.currentPeriodEnd.slice(0, 10)}.</p>
          )}
          {status.effectiveStatus === 'past_due' && (
            <p className="text-sm text-amber-600">
              Your payment is overdue. You still have full access during the grace period, but renew soon to avoid being locked out.
            </p>
          )}
          {status.effectiveStatus === 'locked' && (
            <p className="text-sm text-red-600">Your subscription has lapsed — every screen still works, but changes are blocked until you renew.</p>
          )}

          {status.effectiveStatus !== 'active' && (
            <Button className="mt-4" onClick={renew} disabled={renewing}>
              {renewing ? 'Renewing…' : 'Renew now (demo)'}
            </Button>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="What you've purchased" subtitle="Modules currently enabled for this organization." />
        <CardBody>
          {status.enabledModules.length === 0 ? (
            <p className="text-sm text-slate-400">No modules enabled yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {status.enabledModules.map((m) => (
                <Badge key={m} tone="available">
                  {MODULE_LABEL[m] ?? m}
                </Badge>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
