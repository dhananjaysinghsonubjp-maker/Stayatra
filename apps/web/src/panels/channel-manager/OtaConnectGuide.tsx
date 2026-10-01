import { useEffect, useState } from 'react';
import { mutate, query } from '../../api';
import { useAuth } from '../../AuthContext';
import { Badge, Button, Card } from '../../components/ui';
import { OTA_CODES, OTA_LABEL } from './ota-labels';
import { OTA_ACCESS_NOTE } from './ota-credential-schema';
import type { OtaConnection } from '../../types';

/**
 * In-app documentation for "how do I connect an OTA," written for the hotel
 * owner, not the engineering team — and, per explicit request, actionable in
 * the same place: step 1 has real "+ Connect" buttons, not just instructions
 * pointing elsewhere. Honest about what's real today: the in-app workflow
 * (connect/map/credentials/sync) is fully functional, but no adapter has live
 * API access yet (§7 Phase 1 #7/#8 — every OTA is still a stub, per
 * ota-sync.service.ts). Doesn't invent partner-program URLs — those change
 * and should come from the OTA directly.
 */
export function OtaConnectGuide({ hotelId, onClose }: { hotelId: string; onClose: () => void }) {
  const { token } = useAuth();
  const [connections, setConnections] = useState<OtaConnection[]>([]);
  const [connecting, setConnecting] = useState<string | null>(null);

  async function refresh() {
    setConnections(await query<OtaConnection[]>('ota.listConnections', { hotelId }, token ?? undefined));
  }
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId]);

  async function connect(otaCode: string) {
    setConnecting(otaCode);
    try {
      await mutate('ota.createConnection', { hotelId, otaCode }, token ?? undefined);
      await refresh();
    } finally {
      setConnecting(null);
    }
  }

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-slate-900/40 px-4 py-8">
      <Card className="max-h-[90vh] w-full max-w-2xl overflow-y-auto p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-900">How to connect an OTA</h3>
          <button onClick={onClose} className="text-xs font-medium text-slate-400 hover:text-slate-700">
            Close
          </button>
        </div>

        <div className="space-y-5 text-sm text-slate-700">
          <section>
            <h4 className="mb-2 font-semibold text-slate-900">Step 1 — Connect a channel</h4>
            <div className="mb-2 flex flex-wrap gap-2">
              {OTA_CODES.map((code) => {
                const connection = connections.find((c) => c.otaCode === code);
                return connection ? (
                  <span key={code} className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700">
                    {OTA_LABEL[code]}
                    <Badge tone={connection.status === 'connected' ? 'available' : connection.status === 'error' ? 'flagged' : 'slate'}>
                      {connection.status}
                    </Badge>
                  </span>
                ) : (
                  <button
                    key={code}
                    onClick={() => connect(code)}
                    disabled={connecting === code}
                    className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 disabled:opacity-50"
                  >
                    {OTA_LABEL[code]}
                    <span className="text-xs text-brand-600">{connecting === code ? 'connecting…' : '+ Connect'}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-slate-500">Connecting creates the channel record here — its status starts as "pending" until it's fully set up below.</p>
          </section>

          <section>
            <h4 className="mb-1.5 font-semibold text-slate-900">Then, to finish setup</h4>
            <ol className="list-decimal space-y-2 pl-5">
              <li>
                <span className="font-medium">Map your rooms</span> — go to Connected Channels → "Map rooms" (or Linked Inventory), and tell us what each of your room categories is called on that OTA's own listing. Every rate push depends on this — an unmapped category can't be sent anywhere.
              </li>
              <li>
                <span className="font-medium">Enter what that channel actually needs</span> — the Credentials page asks for the specific IDs/tokens each OTA requires (e.g. Hotel ID + Access Token for MMT, Property ID + Connectivity ID for Agoda — see the breakdown below), not a generic login. This is encrypted before it's stored — nobody, including platform staff, can read it back once saved. You can also set that channel's commission % here, which is what powers "Payable to Property" on your reports.
              </li>
              <li>
                <span className="font-medium">Push your rates</span> — set prices and availability on Bulk Update, Value Override, or Calendar, then use Full Sync (on Connected Channels) to force a complete re-push at any time.
              </li>
            </ol>
          </section>

          <section className="rounded-lg bg-amber-50 p-4">
            <h4 className="mb-1.5 font-semibold text-amber-800">Important: what's real today</h4>
            <p className="text-amber-900">
              The workflow above is fully working end to end — connecting, mapping, credentials, encryption, rate storage, restrictions. What isn't wired up yet is the
              very last mile: actually sending your rates to MakeMyTrip, Booking.com, or any other OTA's servers. Every channel currently simulates a successful push
              so you can test the whole flow, but nothing leaves this system yet. Getting that real connection live is the next milestone, not something you need to
              do anything about here.
            </p>
          </section>

          <section>
            <h4 className="mb-1.5 font-semibold text-slate-900">What each channel actually requires (researched per OTA, not generic)</h4>
            <div className="space-y-3">
              {OTA_CODES.map((code) => (
                <div key={code} className="rounded-lg border border-slate-100 p-3">
                  <p className="text-sm font-semibold text-slate-800">{OTA_LABEL[code]}</p>
                  <p className="mt-0.5 text-slate-600">{OTA_ACCESS_NOTE[code]}</p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-slate-500">
              These programs change over time — the right next step is always to contact each OTA's own partner/connectivity team directly, or ask your existing
              account manager there if you already list with them, rather than rely on a URL here.
            </p>
          </section>
        </div>

        <div className="mt-6 flex justify-end">
          <Button onClick={onClose}>Got it</Button>
        </div>
      </Card>
    </div>
  );
}
