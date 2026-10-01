import { useEffect, useState } from 'react';
import { mutate, query } from '../api';
import { useAuth } from '../AuthContext';
import type { Notification } from '../types';
import type { Tab } from '../layout/Sidebar';

const POLL_MS = 20000;

function timeAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const TYPE_TONE: Record<Notification['type'], string> = {
  sync_failed: 'bg-red-500',
  booking_created: 'bg-emerald-500',
  booking_cancelled: 'bg-amber-500',
};

export function NotificationBell({ hotelId, onNavigate }: { hotelId: string; onNavigate: (tab: Tab) => void }) {
  const { token } = useAuth();
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);

  async function refresh() {
    const [list, count] = await Promise.all([
      query<Notification[]>('notifications.list', { hotelId, limit: 20 }, token ?? undefined),
      query<number>('notifications.unreadCount', { hotelId }, token ?? undefined),
    ]);
    setItems(list);
    setUnread(count);
  }

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId]);

  async function openNotification(n: Notification) {
    if (!n.read) {
      await mutate('notifications.markRead', { id: n.id }, token ?? undefined);
      void refresh();
    }
    setOpen(false);
    if (n.link) onNavigate(n.link as Tab);
  }

  async function markAllRead() {
    await mutate('notifications.markAllRead', { hotelId }, token ?? undefined);
    void refresh();
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
        aria-label="Notifications"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
          <path d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2a2 2 0 01-.6 1.4L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-2 w-80 rounded-xl border border-slate-200 bg-white shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
              <p className="text-sm font-semibold text-slate-900">Notifications</p>
              {unread > 0 && (
                <button onClick={markAllRead} className="text-xs font-medium text-brand-600 hover:underline">
                  Mark all read
                </button>
              )}
            </div>
            <div className="max-h-96 overflow-y-auto">
              {items.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-400">Nothing yet</p>}
              {items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => openNotification(n)}
                  className={`flex w-full gap-2.5 border-b border-slate-50 px-4 py-3 text-left hover:bg-slate-50 ${n.read ? '' : 'bg-brand-50/40'}`}
                >
                  <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${TYPE_TONE[n.type]}`} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{n.title}</p>
                    <p className="truncate text-xs text-slate-500">{n.body}</p>
                    <p className="mt-0.5 text-[11px] text-slate-400">{timeAgo(n.createdAt)}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
