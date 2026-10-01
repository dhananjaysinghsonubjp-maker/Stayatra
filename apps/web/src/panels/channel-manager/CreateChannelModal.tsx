import { useState } from 'react';
import { mutate, ApiError } from '../../api';
import { useAuth } from '../../AuthContext';
import { Button, Card, Field, inputClass } from '../../components/ui';
import { OTA_LABEL } from './ota-labels';
import { OTA_ACCESS_NOTE, OTA_CREDENTIAL_FIELDS } from './ota-credential-schema';

/**
 * One flow instead of two: pick the OTA from a dropdown, fill exactly the
 * IDs/tokens that OTA requires, and submit — this both creates the
 * connection and saves its credentials in one action, rather than
 * connecting on one screen and hunting down Credentials afterward.
 */
export function CreateChannelModal({
  hotelId,
  availableOtaCodes,
  initialOtaCode,
  onClose,
  onCreated,
}: {
  hotelId: string;
  availableOtaCodes: string[];
  /** Pre-selects the channel (e.g. opened from that channel's own "+ Connect" button) — skips picking from the dropdown. */
  initialOtaCode?: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { token } = useAuth();
  const [otaCode, setOtaCode] = useState(initialOtaCode ?? '');
  const [values, setValues] = useState<Record<string, string>>({});
  const [commissionRatePercent, setCommissionRatePercent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fields = otaCode ? OTA_CREDENTIAL_FIELDS[otaCode] ?? [] : [];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!otaCode) {
      setError('Choose a channel first');
      return;
    }
    setBusy(true);
    try {
      const connection = await mutate<{ id: string }>('ota.createConnection', { hotelId, otaCode }, token ?? undefined);
      const credentials: Record<string, string> = {};
      for (const f of fields) {
        if (values[f.key]) credentials[f.key] = values[f.key];
      }
      if (Object.keys(credentials).length > 0) {
        await mutate('ota.setCredentials', { otaConnectionId: connection.id, credentials }, token ?? undefined);
      }
      if (commissionRatePercent) {
        await mutate('ota.setCommissionRate', { otaConnectionId: connection.id, commissionRatePercent: Number(commissionRatePercent) }, token ?? undefined);
      }
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create channel');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-slate-900/40 px-4">
      <Card className="w-full max-w-lg p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">Create channel</h3>
          <button onClick={onClose} className="text-xs font-medium text-slate-400 hover:text-slate-700">
            Close
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          {initialOtaCode ? (
            <p className="text-sm text-slate-700">
              Connecting <span className="font-semibold">{OTA_LABEL[initialOtaCode] ?? initialOtaCode}</span>
            </p>
          ) : (
            <Field label="Channel">
              <select className={inputClass} value={otaCode} onChange={(e) => { setOtaCode(e.target.value); setValues({}); }} autoFocus>
                <option value="">— select an OTA —</option>
                {availableOtaCodes.map((c) => (
                  <option key={c} value={c}>
                    {OTA_LABEL[c] ?? c}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {otaCode && (
            <>
              {OTA_ACCESS_NOTE[otaCode] && <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">{OTA_ACCESS_NOTE[otaCode]}</p>}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {fields.map((f) => (
                  <Field key={f.key} label={f.label}>
                    <input
                      className={inputClass}
                      type={f.type === 'password' ? 'password' : 'text'}
                      value={values[f.key] ?? ''}
                      onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                      autoComplete={f.type === 'password' ? 'new-password' : 'off'}
                      placeholder={f.placeholder}
                    />
                  </Field>
                ))}
                <Field label="Commission rate (%) — optional">
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
              </div>
              <p className="text-xs text-slate-400">Fields left blank can be filled in later from the Credentials page. Everything here is encrypted at rest.</p>
            </>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !otaCode}>
              {busy ? 'Connecting…' : 'Create channel'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
