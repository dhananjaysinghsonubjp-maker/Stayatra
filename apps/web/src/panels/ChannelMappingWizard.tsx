import { useEffect, useState } from 'react';
import { mutate, query, ApiError } from '../api';
import { useAuth } from '../AuthContext';
import { Button, Card, inputClass } from '../components/ui';
import type { OtaConnection, OtaRemoteProduct, OtaRoomMapping, RoomCategory } from '../types';

/**
 * §7 Phase 1 #6 / §10: "the single highest-effort, most important screen in
 * the whole product." Guided, one-category-at-a-time flow with inline
 * progress rather than a bare form — bulk pushes to this channel can't
 * actually go out until every room category has an OTA-side name to map to.
 *
 * Once a real adapter can fetch the OTA's own room/rate list (Agoda's
 * GetProduct, per direct-ota-integration-guide.md §3 step 6), this becomes a
 * dropdown of real codes instead of free text — a real adapter's pushRates
 * needs the code, not just a display name, to actually push anywhere.
 */
export function ChannelMappingWizard({
  connection,
  categories,
  onClose,
}: {
  connection: OtaConnection;
  categories: RoomCategory[];
  onClose: () => void;
}) {
  const { token } = useAuth();
  const [mappings, setMappings] = useState<OtaRoomMapping[]>([]);
  const [remoteProducts, setRemoteProducts] = useState<OtaRemoteProduct[]>([]);
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState('');
  const [selectedProductKey, setSelectedProductKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const [rows, products] = await Promise.all([
      query<OtaRoomMapping[]>('ota.listRoomMappings', { otaConnectionId: connection.id }, token ?? undefined),
      query<OtaRemoteProduct[]>('ota.fetchRemoteProducts', { otaConnectionId: connection.id }, token ?? undefined).catch(() => []),
    ]);
    setMappings(rows);
    setRemoteProducts(products);
  }
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection.id]);

  const current = categories[step];
  const existing = mappings.find((m) => m.roomCategoryId === current?.id);
  const mappedCount = categories.filter((c) => mappings.some((m) => m.roomCategoryId === c.id)).length;
  const done = step >= categories.length;
  const hasRealProducts = remoteProducts.length > 0;

  useEffect(() => {
    setDraft(existing?.otaRoomName ?? '');
    setSelectedProductKey(existing?.otaRoomCode && existing?.otaRatePlanCode ? `${existing.otaRoomCode}::${existing.otaRatePlanCode}` : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, connection.id]);

  async function saveAndNext() {
    if (!current) return;
    setBusy(true);
    setError(null);
    try {
      if (hasRealProducts) {
        const [roomCode, ratePlanCode] = selectedProductKey.split('::');
        const product = remoteProducts.find((p) => p.roomCode === roomCode && p.ratePlanCode === ratePlanCode);
        if (!product) {
          setError('Pick a room from the list');
          setBusy(false);
          return;
        }
        await mutate(
          'ota.mapRoomCategory',
          {
            otaConnectionId: connection.id,
            roomCategoryId: current.id,
            otaRoomName: `${product.roomName} (${product.ratePlanName})`,
            otaRoomCode: product.roomCode,
            otaRatePlanCode: product.ratePlanCode,
          },
          token ?? undefined,
        );
      } else {
        if (!draft.trim()) {
          setBusy(false);
          return;
        }
        await mutate('ota.mapRoomCategory', { otaConnectionId: connection.id, roomCategoryId: current.id, otaRoomName: draft.trim() }, token ?? undefined);
      }
      await refresh();
      setStep((s) => s + 1);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save mapping');
    } finally {
      setBusy(false);
    }
  }

  const canSave = hasRealProducts ? Boolean(selectedProductKey) : Boolean(draft.trim());

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-slate-900/40 px-4">
      <Card className="w-full max-w-lg p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">Room/Rate mapping — {connection.otaCode}</h3>
          <button onClick={onClose} className="text-xs font-medium text-slate-400 hover:text-slate-700">
            Close
          </button>
        </div>

        <div className="mb-5 h-1.5 w-full rounded-full bg-slate-100">
          <div
            className="h-1.5 rounded-full bg-brand-600 transition-all"
            style={{ width: categories.length ? `${(mappedCount / categories.length) * 100}%` : '0%' }}
          />
        </div>
        <p className="mb-4 text-xs text-slate-500">{mappedCount} of {categories.length} room categories mapped</p>

        {categories.length === 0 ? (
          <p className="text-sm text-slate-500">Create a room category first (Setup tab), then come back here to map it to {connection.otaCode}.</p>
        ) : done ? (
          <div className="space-y-4">
            <p className="text-sm font-medium text-emerald-600">✓ All room categories mapped for {connection.otaCode}.</p>
            <div className="space-y-1.5">
              {categories.map((c) => (
                <div key={c.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                  <span className="text-slate-700">{c.name}</span>
                  <span className="text-slate-500">→ {mappings.find((m) => m.roomCategoryId === c.id)?.otaRoomName}</span>
                  <button onClick={() => setStep(categories.indexOf(c))} className="text-xs font-medium text-brand-600 hover:underline">
                    edit
                  </button>
                </div>
              ))}
            </div>
            <Button onClick={onClose} className="w-full">
              Done
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg bg-slate-50 px-4 py-3">
              <p className="text-xs text-slate-400">Our room category</p>
              <p className="text-base font-semibold text-slate-900">{current.name}</p>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-500">
                What is this room called on {connection.otaCode}?
              </label>
              {hasRealProducts ? (
                <select className={inputClass} autoFocus value={selectedProductKey} onChange={(e) => setSelectedProductKey(e.target.value)}>
                  <option value="">— pick from {connection.otaCode}'s own room list —</option>
                  {remoteProducts.map((p) => (
                    <option key={`${p.roomCode}::${p.ratePlanCode}`} value={`${p.roomCode}::${p.ratePlanCode}`}>
                      {p.roomName} — {p.ratePlanName}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  autoFocus
                  className={inputClass}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="e.g. Deluxe Room with Balcony"
                  onKeyDown={(e) => e.key === 'Enter' && saveAndNext()}
                />
              )}
              <p className="mt-1 text-xs text-slate-400">
                {hasRealProducts
                  ? "Pulled live from this channel's own room/rate list — pushes will use its real codes."
                  : 'Free-text for now — this channel has no real connectivity yet, so there\'s no live room list to pick from.'}
              </p>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-between gap-2">
              <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
                ← Back
              </Button>
              <Button onClick={saveAndNext} disabled={busy || !canSave}>
                {step === categories.length - 1 ? 'Save & finish' : 'Save & next →'}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
