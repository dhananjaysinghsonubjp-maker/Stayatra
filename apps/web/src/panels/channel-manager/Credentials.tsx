import { useEffect, useState } from 'react';
import { mutate, query, ApiError } from '../../api';
import { useAuth } from '../../AuthContext';
import { Badge, Button, Card, Field, PageHeader, inputClass } from '../../components/ui';
import { useCmSelection } from './useCmSelection';
import { OTA_LABEL } from './ota-labels';
import { OTA_ACCESS_NOTE, OTA_CREDENTIAL_FIELDS } from './ota-credential-schema';
import type { OtaConnection } from '../../types';

/** §7 Phase 1 #13 — encrypted vault; plus §6's channel commission % (feeds "payable to property" on the bookings table). */
export function Credentials({ hotelId }: { hotelId: string }) {
  const cm = useCmSelection(hotelId);

  return (
    <div>
      <PageHeader title="Credentials" subtitle="What each channel actually asks for — researched per OTA, not a one-size-fits-all login form." />
      {cm.connections.length === 0 ? (
        <Card className="p-6 text-center text-sm text-slate-400">Connect a channel first, from Connected Channels.</Card>
      ) : (
        <div className="space-y-4">
          {cm.connections.map((c) => (
            <CredentialCard key={c.id} connection={c} />
          ))}
        </div>
      )}
    </div>
  );
}

function CredentialCard({ connection }: { connection: OtaConnection }) {
  const { token } = useAuth();
  const fields = OTA_CREDENTIAL_FIELDS[connection.otaCode] ?? [];
  const [status, setStatus] = useState<{ hasCredentials: boolean; updatedAt: string | null } | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [commissionRatePercent, setCommissionRatePercent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  async function refresh() {
    const s = await query<{ hasCredentials: boolean; updatedAt: string | null }>('ota.getCredentialStatus', { otaConnectionId: connection.id }, token ?? undefined);
    setStatus(s);
  }
  useEffect(() => {
    void refresh();
    setCommissionRatePercent(connection.commissionRatePercent ?? '');
    setValues({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection.id]);

  async function saveCredentials(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    setSaved(false);
    try {
      const credentials: Record<string, string> = {};
      for (const f of fields) {
        if (values[f.key]) credentials[f.key] = values[f.key];
      }
      await mutate('ota.setCredentials', { otaConnectionId: connection.id, credentials }, token ?? undefined);
      await mutate(
        'ota.setCommissionRate',
        { otaConnectionId: connection.id, commissionRatePercent: commissionRatePercent === '' ? null : Number(commissionRatePercent) },
        token ?? undefined,
      );
      setValues({});
      setSaved(true);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-sm font-semibold text-slate-900">{OTA_LABEL[connection.otaCode] ?? connection.otaCode}</h3>
        <Badge tone={status?.hasCredentials ? 'available' : 'slate'}>{status?.hasCredentials ? 'credentials saved' : 'not set'}</Badge>
      </div>
      {OTA_ACCESS_NOTE[connection.otaCode] && <p className="mb-4 text-xs text-slate-500">{OTA_ACCESS_NOTE[connection.otaCode]}</p>}
      <form onSubmit={saveCredentials} className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        {fields.map((f) => (
          <Field key={f.key} label={f.label}>
            <input
              className={inputClass}
              type={f.type === 'password' ? 'password' : 'text'}
              value={values[f.key] ?? ''}
              onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
              autoComplete={f.type === 'password' ? 'new-password' : 'off'}
              placeholder={status?.hasCredentials ? '••••••••' : f.placeholder}
            />
          </Field>
        ))}
        <Field label="Commission rate (%)">
          <input
            className={inputClass}
            type="number"
            min={0}
            max={100}
            step="0.01"
            value={commissionRatePercent}
            onChange={(e) => setCommissionRatePercent(e.target.value)}
            placeholder="e.g. 18"
          />
        </Field>
        <div className="sm:col-span-4">
          {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
          {saved && <p className="mb-2 text-sm text-emerald-600">Saved.</p>}
          <Button type="submit" variant="secondary" disabled={busy}>
            Save (encrypted at rest)
          </Button>
        </div>
      </form>
    </Card>
  );
}
