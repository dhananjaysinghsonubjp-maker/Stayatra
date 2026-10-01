import { useEffect, useState } from 'react';
import { query } from '../api';
import { useAuth } from '../AuthContext';
import { Badge, Card, PageHeader } from '../components/ui';

interface AuditRow {
  id: string;
  eventType: string;
  actorName: string;
  subjectId: string | null;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

const EVENT_LABEL: Record<string, string> = {
  RATE_BULK_UPDATE: 'Bulk rate/inventory update',
  RATE_VALUE_OVERRIDE: 'Value override',
  RESTRICTION_UPDATED: 'Restriction changed',
  ROOM_MAPPING_UPDATED: 'Room mapping changed',
  CREDENTIALS_UPDATED: 'Channel credentials saved',
  CHANNEL_CONNECTED: 'Channel connected',
  CHECK_IN: 'Guest checked in',
  PAYMENT_RECEIVED: 'Payment received',
  CLEANING_SUBMITTED: 'Cleaning submitted',
  CLEANING_FLAGGED: 'Cleaning flagged',
  DISCREPANCY_RESOLVED: 'Discrepancy resolved',
  STAY_EDITED: 'Stay edited',
  ROOM_CHANGED: 'Room changed',
  GUEST_CLEANING: 'Guest-stay cleaning',
  MANUAL_BLOCK: 'Room manually blocked',
  UNRECORDED_OCCUPANCY_FLAGGED: 'Unrecorded occupancy flagged',
  SYNC_FAILED: 'OTA sync failed',
  DELAY_RESOLVED: 'Delay resolved',
};

const EVENT_TONE: Record<string, string> = {
  RATE_BULK_UPDATE: 'bulk_update',
  RATE_VALUE_OVERRIDE: 'value_override',
  RESTRICTION_UPDATED: 'value_override',
  ROOM_MAPPING_UPDATED: 'ota_push',
  CREDENTIALS_UPDATED: 'ota_push',
  CHANNEL_CONNECTED: 'available',
  SYNC_FAILED: 'flagged',
};

/** Phase 2's "Audit logs screen" (§7) — a plain read over audit_log, spanning both CM and PMS actions, whichever this org has. */
export function AuditLog({ hotelId }: { hotelId: string }) {
  const { token } = useAuth();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    query<AuditRow[]>('audit.list', { hotelId }, token ?? undefined)
      .then(setRows)
      .catch(() => setError('Failed to load audit log'));
  }, [hotelId, token]);

  return (
    <div>
      <PageHeader title="Audit Log" subtitle="Every rate, restriction, mapping, and credential change — who did what, and when." />
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      <Card>
        {rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-slate-400">No activity recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-medium text-slate-500">
                  <th className="px-5 py-3">When</th>
                  <th className="px-5 py-3">Event</th>
                  <th className="px-5 py-3">By</th>
                  <th className="px-5 py-3">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap px-5 py-3 text-slate-500">{new Date(r.createdAt).toLocaleString('en-IN')}</td>
                    <td className="px-5 py-3">
                      <Badge tone={EVENT_TONE[r.eventType] ?? 'slate'}>{EVENT_LABEL[r.eventType] ?? r.eventType}</Badge>
                    </td>
                    <td className="px-5 py-3 text-slate-700">{r.actorName}</td>
                    <td className="px-5 py-3 text-xs text-slate-400">{r.detail ? JSON.stringify(r.detail) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
