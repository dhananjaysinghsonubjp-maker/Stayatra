import { useEffect, useState } from 'react';
import { mutate, query, ApiError } from '../../api';
import { useAuth } from '../../AuthContext';
import { Badge, Button, Card, EmptyState, PageHeader, inputClass } from '../../components/ui';
import { formatDateTimeShort } from '../../dateFormat';
import type { DailyIssue } from '../../types';

/** §user request, with a reference app's own "Daily Issues Log" as the target — a plain day-to-day
 * operational issue log (AC not working in 203, etc.): title/description/status, who reported it
 * and who resolved it. Deliberately simple — no categories, priority or assignment. */
export function DailyIssuesLog({ hotelId }: { hotelId: string }) {
  const { token } = useAuth();
  const [status, setStatus] = useState<'open' | 'resolved' | 'all'>('open');
  const [rows, setRows] = useState<DailyIssue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function refresh() {
    setError(null);
    try {
      setRows(await query<DailyIssue[]>('masterData.listDailyIssues', { hotelId, status: status === 'all' ? undefined : status }, token ?? undefined));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load issues');
    }
  }
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId, status]);

  async function add() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await mutate('masterData.createDailyIssue', { hotelId, title: title.trim(), description: description.trim() || undefined }, token ?? undefined);
      setTitle('');
      setDescription('');
      setAdding(false);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to report issue');
    } finally {
      setSaving(false);
    }
  }

  async function resolve(id: string) {
    setBusyId(id);
    try {
      await mutate('masterData.resolveDailyIssue', { id }, token ?? undefined);
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function reopen(id: string) {
    setBusyId(id);
    try {
      await mutate('masterData.reopenDailyIssue', { id }, token ?? undefined);
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <PageHeader title="Daily Issues Log" subtitle="Day-to-day operational issues — report, track and resolve." action={<Button onClick={() => setAdding((v) => !v)}>+ Report Issue</Button>} />

      <div className="mb-4 flex gap-2">
        {(['open', 'resolved', 'all'] as const).map((s) => (
          <Button key={s} variant={status === s ? 'primary' : 'secondary'} className="text-xs capitalize" onClick={() => setStatus(s)}>
            {s}
          </Button>
        ))}
      </div>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {adding && (
        <Card className="mb-4 p-4">
          <div className="space-y-3">
            <input className={inputClass} placeholder="Issue title — e.g. AC not working in Room 203" value={title} onChange={(e) => setTitle(e.target.value)} />
            <textarea className={`${inputClass} min-h-16`} placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
            <div className="flex gap-2">
              <Button onClick={() => void add()} disabled={saving || !title.trim()}>
                {saving ? 'Reporting…' : 'Report Issue'}
              </Button>
              <Button variant="secondary" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </Card>
      )}

      {rows.length === 0 ? (
        <Card className="p-6">
          <EmptyState title="No issues" hint={status === 'open' ? 'Nothing open right now.' : undefined} />
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((issue) => (
            <Card key={issue.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="font-semibold text-slate-900 dark:text-white">{issue.title}</span>
                    <Badge tone={issue.status === 'open' ? 'flagged' : 'available'}>{issue.status}</Badge>
                  </div>
                  {issue.description && <p className="text-sm text-slate-600 dark:text-slate-300">{issue.description}</p>}
                  <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
                    Reported by {issue.reportedByName} · {formatDateTimeShort(issue.createdAt)}
                  </p>
                  {issue.resolvedByName && (
                    <p className="text-xs text-slate-400 dark:text-slate-500">
                      Resolved by {issue.resolvedByName}
                      {issue.resolvedAt ? ` · ${formatDateTimeShort(issue.resolvedAt)}` : ''}
                    </p>
                  )}
                </div>
                <div className="shrink-0">
                  {issue.status === 'open' ? (
                    <Button variant="secondary" className="text-xs" disabled={busyId === issue.id} onClick={() => void resolve(issue.id)}>
                      {busyId === issue.id ? 'Resolving…' : 'Mark Resolved'}
                    </Button>
                  ) : (
                    <Button variant="secondary" className="text-xs" disabled={busyId === issue.id} onClick={() => void reopen(issue.id)}>
                      {busyId === issue.id ? 'Reopening…' : 'Reopen'}
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
