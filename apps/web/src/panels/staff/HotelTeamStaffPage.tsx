import { useState } from 'react';
import { mutate, ApiError } from '../../api';
import { Button, Card, CardBody, CardHeader, Field, PageHeader, inputClass } from '../../components/ui';
import { StaffManagement } from './StaffManagement';
import { Housekeeping } from '../Housekeeping';

/** Self-service — the logged-in owner/manager sets their OWN PIN for the universal Property ID +
 * PIN login, separate from the staff roster below (which is about everyone else). */
function MyPinSection({ token }: { token: string | null }) {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    if (!/^\d{4}$/.test(pin)) {
      setError('PIN must be exactly 4 digits');
      return;
    }
    if (pin !== confirmPin) {
      setError('PINs don’t match');
      return;
    }
    setSaving(true);
    try {
      await mutate('auth.setMyPin', { pin }, token ?? undefined);
      setMessage('PIN saved. You can now log in with Property ID + your role + this PIN.');
      setPin('');
      setConfirmPin('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save PIN');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader title="My PIN" subtitle="Set the 4-digit PIN you'll use to log in, instead of email + password, going forward." />
      <CardBody>
        <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:items-end">
          <Field label="New PIN">
            <input
              className={`${inputClass} text-center tracking-[0.4em]`}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              inputMode="numeric"
              placeholder="····"
              required
            />
          </Field>
          <Field label="Confirm PIN">
            <input
              className={`${inputClass} text-center tracking-[0.4em]`}
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              inputMode="numeric"
              placeholder="····"
              required
            />
          </Field>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save PIN'}
          </Button>
          {error && <p className="sm:col-span-3 text-sm text-red-600">{error}</p>}
          {message && <p className="sm:col-span-3 text-sm text-emerald-600">{message}</p>}
        </form>
      </CardBody>
    </Card>
  );
}

/**
 * §user request — "Hotel Team ke andar jo Housekeeping section hai usko replace karke naam
 * 'Staff' karo, uske andar poora Staff & PINs wala roster rahega": the roster (StaffManagement,
 * already position-grouped: GM → FMO → Housekeeping) and the cleaning-operations monitoring page
 * (Housekeeping.tsx — records/discrepancies) used to be two separate sidebar entries; now they're
 * one "Staff" entry with an in-page tab switch, same pattern as Reports' "Rooms Report / Sale
 * Report" buttons. Housekeeping Records stays owner-only (it already was, in spirit — a manager's
 * old view of that page was just a cut-down roster card, which the richer Staff tab now
 * supersedes entirely, so there's no redundant copy to keep around).
 */
export function HotelTeamStaffPage({ hotelId, token, isOwner }: { hotelId: string; token: string | null; isOwner: boolean }) {
  const [tab, setTab] = useState<'staff' | 'housekeeping'>('staff');

  return (
    <div>
      <PageHeader title="Staff" subtitle="Who works here, their PINs, and (owner) housekeeping operations." />
      {isOwner && (
        <div className="mb-6 flex gap-2">
          <Button variant={tab === 'staff' ? 'primary' : 'secondary'} onClick={() => setTab('staff')}>
            Staff
          </Button>
          <Button variant={tab === 'housekeeping' ? 'primary' : 'secondary'} onClick={() => setTab('housekeeping')}>
            Housekeeping Records
          </Button>
        </div>
      )}
      {tab === 'staff' ? (
        <div className="space-y-6">
          <MyPinSection token={token} />
          <StaffManagement hotelId={hotelId} token={token} isOwner={isOwner} />
        </div>
      ) : (
        <Housekeeping hotelId={hotelId} hideHeader />
      )}
    </div>
  );
}
