import { useEffect, useState } from 'react';
import { mutate, query, ApiError } from '../../api';
import { useAuth } from '../../AuthContext';
import { Badge, Button, Card, EmptyState, PageHeader } from '../../components/ui';
import { formatDateShort, formatDateTimeShort } from '../../dateFormat';
import type { RateChangeRequest } from '../../types';

const STATUS_TABS: { value: 'pending' | 'approved' | 'rejected' | 'all'; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'all', label: 'All' },
];

const RULE_LABEL: Record<RateChangeRequest['modificationRule'], string> = {
  set: 'Set to',
  increase: 'Increase by',
  decrease: 'Decrease by',
};

const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * §user request, with a reference app's own "Approval Request" screen as the target — a manager's
 * Bulk Update (Rate & Invt. Update) sits here `pending` until an owner approves or rejects it; an
 * owner's own request shows up here too, already `approved`, so there's one place to see every
 * bulk rate change regardless of who made it.
 */
export function ApprovalRequests({ hotelId }: { hotelId: string }) {
  const { token, role } = useAuth();
  const isOwner = role('channel_manager') === 'owner';
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [requests, setRequests] = useState<RateChangeRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  async function refresh() {
    setError(null);
    try {
      setRequests(await query<RateChangeRequest[]>('rates.listRateChangeRequests', { hotelId, status: status === 'all' ? undefined : status }, token ?? undefined));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load approval requests');
    }
  }
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId, status]);

  async function approve(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await mutate('rates.approveRateChangeRequest', { requestId: id }, token ?? undefined);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to approve');
    } finally {
      setBusyId(null);
    }
  }

  async function reject(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await mutate('rates.rejectRateChangeRequest', { requestId: id, reason: rejectReason.trim() || undefined }, token ?? undefined);
      setRejectingId(null);
      setRejectReason('');
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to reject');
    } finally {
      setBusyId(null);
    }
  }

  function describeDays(req: RateChangeRequest) {
    if (req.daysOfWeek.length === 0 || req.daysOfWeek.length === 7) return 'All days';
    return req.daysOfWeek
      .slice()
      .sort((a, b) => a - b)
      .map((d) => DOW_SHORT[d])
      .join(', ');
  }

  return (
    <div>
      <PageHeader title="Approval Requests" subtitle="Bulk rate change requests — a manager's request waits here for an owner's sign-off." />

      <div className="mb-5 flex gap-2">
        {STATUS_TABS.map((t) => (
          <Button key={t.value} variant={status === t.value ? 'primary' : 'secondary'} className="text-xs" onClick={() => setStatus(t.value)}>
            {t.label}
          </Button>
        ))}
      </div>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {requests.length === 0 ? (
        <Card className="p-6">
          <EmptyState title="No requests" hint={status === 'pending' ? 'No bulk rate changes waiting for approval.' : undefined} />
        </Card>
      ) : (
        <div className="space-y-3">
          {requests.map((req) => (
            <Card key={req.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-slate-900 dark:text-white">{req.roomCategoryNames.join(', ')}</span>
                    <Badge tone={req.status === 'approved' ? 'available' : req.status === 'rejected' ? 'flagged' : 'slate'}>{req.status}</Badge>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {formatDateShort(req.startDate)} → {formatDateShort(req.endDate)} · {describeDays(req)}
                  </p>
                  <p className="mt-1.5 text-sm text-slate-700 dark:text-slate-200">
                    <span className="font-medium">{RULE_LABEL[req.modificationRule]}</span> ₹{Number(req.value).toFixed(2)}
                    {req.discountPercent && Number(req.discountPercent) > 0 && <span> · {Number(req.discountPercent)}% discount on top</span>}
                  </p>
                  {req.remarks && <p className="mt-1 text-xs italic text-slate-500 dark:text-slate-400">"{req.remarks}"</p>}
                  <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
                    Requested by {req.requestedByName} · {formatDateTimeShort(req.createdAt)}
                  </p>
                  {req.decidedByName && (
                    <p className="text-xs text-slate-400 dark:text-slate-500">
                      {req.status === 'approved' ? 'Approved' : 'Rejected'} by {req.decidedByName}
                      {req.decidedAt ? ` · ${formatDateTimeShort(req.decidedAt)}` : ''}
                      {req.rejectionReason ? ` · "${req.rejectionReason}"` : ''}
                    </p>
                  )}
                </div>

                {req.status === 'pending' && isOwner && (
                  <div className="flex shrink-0 gap-2">
                    <Button variant="secondary" className="text-xs" disabled={busyId === req.id} onClick={() => setRejectingId(req.id)}>
                      Reject
                    </Button>
                    <Button className="text-xs" disabled={busyId === req.id} onClick={() => approve(req.id)}>
                      {busyId === req.id ? 'Approving…' : 'Approve'}
                    </Button>
                  </div>
                )}
              </div>

              {rejectingId === req.id && (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-700">
                  <input
                    className="min-w-[200px] flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-brand-400 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                    placeholder="Reason (optional)"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                  />
                  <Button variant="secondary" className="text-xs" onClick={() => { setRejectingId(null); setRejectReason(''); }}>
                    Cancel
                  </Button>
                  <Button variant="danger" className="text-xs" disabled={busyId === req.id} onClick={() => reject(req.id)}>
                    {busyId === req.id ? 'Rejecting…' : 'Confirm Reject'}
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
