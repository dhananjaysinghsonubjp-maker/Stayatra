import { useEffect, useState } from 'react';
import { mutate, query } from '../../api';
import { useAuth } from '../../AuthContext';
import { Badge, Button, Card, PageHeader } from '../../components/ui';
import { ChannelMappingWizard } from '../ChannelMappingWizard';
import { useCmSelection } from './useCmSelection';
import { OTA_CODES, OTA_LABEL } from './ota-labels';
import { OtaConnectGuide } from './OtaConnectGuide';
import { CreateChannelModal } from './CreateChannelModal';
import type { OtaConnection, OtaRoomMapping } from '../../types';

/** §7 Phase 1 #7/#8/#9 — one "Create channel" flow (pick OTA, fill exactly what it needs, done) instead of connect-then-hunt-for-credentials. */
export function ConnectedChannels({ hotelId }: { hotelId: string }) {
  const cm = useCmSelection(hotelId);
  const [mappingConnection, setMappingConnection] = useState<OtaConnection | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  // Bumped whenever the mapping wizard closes — ChannelCard's own mapped-count
  // fetch only runs once per connection.id, so nothing else would tell an
  // already-mounted card to refetch after a mapping was just saved.
  const [mappingRefreshKey, setMappingRefreshKey] = useState(0);

  const unconnected = OTA_CODES.filter((c) => !cm.connections.some((x) => x.otaCode === c));

  return (
    <div>
      <PageHeader
        title="Connected Channels"
        subtitle="Connect Booking.com, Airbnb, MakeMyTrip, Agoda, and other OTAs. Setup progress updates as you fill in each one's details."
        action={
          <div className="flex items-center gap-4">
            <button onClick={() => setShowGuide(true)} className="text-xs font-medium text-brand-600 hover:underline">
              How do I connect an OTA? →
            </button>
            {unconnected.length > 0 && <Button onClick={() => setShowCreate(true)}>+ Create channel</Button>}
          </div>
        }
      />

      {cm.connections.length === 0 ? (
        <Card className="p-6 text-center text-sm text-slate-400">No channels connected yet — click "Create channel" above to get started.</Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {cm.connections.map((c) => (
            <ChannelCard
              key={c.id}
              connection={c}
              categoriesCount={cm.categories.length}
              onMap={() => setMappingConnection(c)}
              onRefresh={cm.refreshConnections}
              mappingRefreshKey={mappingRefreshKey}
            />
          ))}
        </div>
      )}

      {mappingConnection && (
        <ChannelMappingWizard
          connection={mappingConnection}
          categories={cm.categories}
          onClose={() => {
            setMappingConnection(null);
            setMappingRefreshKey((k) => k + 1);
          }}
        />
      )}
      {showGuide && (
        <OtaConnectGuide
          hotelId={hotelId}
          onClose={() => {
            setShowGuide(false);
            void cm.refreshConnections();
          }}
        />
      )}
      {showCreate && (
        <CreateChannelModal hotelId={hotelId} availableOtaCodes={unconnected} onClose={() => setShowCreate(false)} onCreated={() => void cm.refreshConnections()} />
      )}
    </div>
  );
}

function ChannelCard({
  connection,
  categoriesCount,
  onMap,
  onRefresh,
  mappingRefreshKey,
}: {
  connection: OtaConnection;
  categoriesCount: number;
  onMap: () => void;
  onRefresh: () => void;
  mappingRefreshKey: number;
}) {
  const { token } = useAuth();
  const [mappedCount, setMappedCount] = useState<number | null>(null);
  const [hasCredentials, setHasCredentials] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState<{ valid: boolean; message?: string } | null>(null);
  const [polling, setPolling] = useState(false);
  const [pollResult, setPollResult] = useState<string | null>(null);

  async function refresh() {
    const [mappings, credStatus] = await Promise.all([
      query<OtaRoomMapping[]>('ota.listRoomMappings', { otaConnectionId: connection.id }, token ?? undefined),
      query<{ hasCredentials: boolean }>('ota.getCredentialStatus', { otaConnectionId: connection.id }, token ?? undefined),
    ]);
    setMappedCount(mappings.length);
    setHasCredentials(credStatus.hasCredentials);
  }
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection.id, mappingRefreshKey]);

  async function runFullSync() {
    setBusy(true);
    try {
      await mutate('ota.fullSync', { otaConnectionId: connection.id }, token ?? undefined);
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 500));
        onRefresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function runTestConnection() {
    setTestResult(null);
    const result = await mutate<{ valid: boolean; message?: string }>('ota.testConnection', { otaConnectionId: connection.id }, token ?? undefined);
    setTestResult(result);
  }

  async function runPollBookings() {
    setPolling(true);
    setPollResult(null);
    try {
      const result = await mutate<{ imported: number; skipped: number }>('ota.pollBookings', { otaConnectionId: connection.id }, token ?? undefined);
      setPollResult(`${result.imported} imported, ${result.skipped} skipped`);
    } finally {
      setPolling(false);
    }
  }

  const statusTone = connection.status === 'connected' ? 'available' : connection.status === 'error' ? 'flagged' : 'slate';

  // Three equal steps toward a fully-usable channel: created, credentials saved, at least one room mapped.
  const steps = [true, hasCredentials === true, (mappedCount ?? 0) > 0 && categoriesCount > 0 && mappedCount === categoriesCount];
  const progress = Math.round((steps.filter(Boolean).length / 3) * 100);

  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">{OTA_LABEL[connection.otaCode] ?? connection.otaCode}</h3>
        <Badge tone={statusTone}>{connection.status}</Badge>
      </div>

      <div className="mb-3">
        <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
          <span>Setup progress</span>
          <span>{progress}%</span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-slate-100">
          <div className="h-1.5 rounded-full bg-brand-600 transition-all" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
        <span>Credentials: {hasCredentials === null ? '…' : hasCredentials ? 'saved' : 'not set'}</span>
        <span>
          Mapping: {mappedCount ?? '…'}/{categoriesCount}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={onMap} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700">
          Map rooms
        </button>
        <button
          type="button"
          onClick={runFullSync}
          disabled={busy}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {busy ? 'Syncing…' : 'Full Sync'}
        </button>
        <button
          type="button"
          onClick={runTestConnection}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          Test connection
        </button>
        <button
          type="button"
          onClick={runPollBookings}
          disabled={polling}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {polling ? 'Polling…' : 'Poll bookings'}
        </button>
      </div>
      {testResult && (
        <p className={`mt-2 text-xs ${testResult.valid ? 'text-emerald-600' : 'text-red-600'}`}>
          {testResult.valid ? '✔' : '✕'} {testResult.message}
        </p>
      )}
      {pollResult && <p className="mt-2 text-xs text-slate-500">{pollResult}</p>}
    </Card>
  );
}
