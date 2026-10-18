import { useEffect, useState } from 'react';
import { mutate, query, ApiError } from '../../api';
import { useAuth } from '../../AuthContext';
import { Button, EmptyState, PageHeader } from '../../components/ui';
import { ChannelIcon } from './ChannelBadge';
import { SOURCE_LABEL } from './ota-labels';

interface ThreadMessage {
  id: string;
  sender: 'guest' | 'staff';
  body: string;
  readByStaff: boolean;
  createdAt: string;
}

interface ThreadSummary {
  bookingId: string;
  guestName: string;
  guestPhone: string | null;
  source: string;
  checkIn: string;
  checkOut: string;
  status: string;
  lastMessage: ThreadMessage | null;
  unreadCount: number;
}

interface MessageableBooking {
  id: string;
  guestName: string;
  guestPhone: string | null;
  source: string;
  checkIn: string;
  checkOut: string;
  status: string;
}

function timeLabel(iso: string) {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function GuestMessaging({
  hotelId,
  initialBookingId,
  onInitialConsumed,
}: {
  hotelId: string;
  /** Set by OTA Reviews' "Message" action (§ user request) — opens straight into that
   * guest's thread instead of landing on the empty "select a conversation" state. */
  initialBookingId?: string | null;
  onInitialConsumed?: () => void;
}) {
  const { token } = useAuth();
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [threadMeta, setThreadMeta] = useState<ThreadSummary | MessageableBooking | null>(null);
  const [draft, setDraft] = useState('');
  const [draftSender, setDraftSender] = useState<'guest' | 'staff'>('staff');
  const [showPicker, setShowPicker] = useState(false);
  const [messageable, setMessageable] = useState<MessageableBooking[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function refreshThreads() {
    setThreads(await query<ThreadSummary[]>('guestMessaging.listThreads', { hotelId }, token ?? undefined));
  }

  useEffect(() => {
    void refreshThreads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId]);

  useEffect(() => {
    if (initialBookingId) {
      void openThread(initialBookingId);
      onInitialConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialBookingId]);

  async function openThread(bookingId: string) {
    setSelected(bookingId);
    setError(null);
    const data = await query<{ booking: MessageableBooking; messages: ThreadMessage[] }>(
      'guestMessaging.getThread',
      { hotelId, bookingId },
      token ?? undefined,
    );
    setThreadMeta(data.booking);
    setMessages(data.messages);
    if (data.messages.some((m) => m.sender === 'guest' && !m.readByStaff)) {
      await mutate('guestMessaging.markRead', { hotelId, bookingId }, token ?? undefined);
      await refreshThreads();
    }
  }

  async function openPicker() {
    setMessageable(await query<MessageableBooking[]>('guestMessaging.listMessageableBookings', { hotelId }, token ?? undefined));
    setShowPicker(true);
  }

  async function startThread(booking: MessageableBooking) {
    setShowPicker(false);
    setSelected(booking.id);
    setThreadMeta(booking);
    setMessages([]);
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || !draft.trim()) return;
    setError(null);
    setSending(true);
    try {
      const msg = await mutate<ThreadMessage>(
        'guestMessaging.send',
        { hotelId, bookingId: selected, sender: draftSender, body: draft.trim() },
        token ?? undefined,
      );
      setMessages((prev) => [...prev, msg]);
      setDraft('');
      await refreshThreads();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to send message');
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Guest Messaging"
        subtitle="Every OTA conversation in one inbox."
        action={
          <Button variant="secondary" onClick={openPicker}>
            + New message
          </Button>
        }
      />

      <div className="flex h-[calc(100vh-220px)] min-h-[420px] overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="w-80 shrink-0 overflow-y-auto border-r border-slate-100">
          {threads.length === 0 ? (
            <div className="p-4">
              <EmptyState title="No guest messages yet" hint="Start a conversation from an active reservation." />
            </div>
          ) : (
            threads.map((t) => (
              <button
                key={t.bookingId}
                onClick={() => void openThread(t.bookingId)}
                className={`flex w-full items-start gap-3 border-b border-slate-50 px-4 py-3 text-left transition-colors hover:bg-slate-50 ${
                  selected === t.bookingId ? 'bg-brand-50' : ''
                }`}
              >
                <ChannelIcon source={t.source} className="mt-0.5 h-8 w-8" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-semibold text-slate-900">{t.guestName}</p>
                    {t.lastMessage && <span className="shrink-0 text-[11px] text-slate-400">{timeLabel(t.lastMessage.createdAt)}</span>}
                  </div>
                  <p className="truncate text-xs text-slate-500">
                    {t.lastMessage ? (t.lastMessage.sender === 'staff' ? 'You: ' : '') + t.lastMessage.body : 'No messages yet'}
                  </p>
                </div>
                {t.unreadCount > 0 && (
                  <span className="mt-1 flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-brand-600 px-1 text-[11px] font-semibold text-white">
                    {t.unreadCount}
                  </span>
                )}
              </button>
            ))
          )}
        </div>

        <div className="flex flex-1 flex-col">
          {!selected || !threadMeta ? (
            <div className="flex flex-1 items-center justify-center">
              <EmptyState title="Select a conversation" hint="Or start a new one from an active reservation." />
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-3">
                <ChannelIcon source={threadMeta.source} className="h-8 w-8" />
                <div>
                  <p className="text-sm font-semibold text-slate-900">{threadMeta.guestName}</p>
                  <p className="text-xs text-slate-500">
                    {SOURCE_LABEL[threadMeta.source] ?? threadMeta.source}
                    {threadMeta.guestPhone ? ` · ${threadMeta.guestPhone}` : ''}
                  </p>
                </div>
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
                {messages.length === 0 && <EmptyState title="No messages in this conversation yet" />}
                {messages.map((m) => (
                  <div key={m.id} className={`flex ${m.sender === 'staff' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-sm rounded-2xl px-3.5 py-2 text-sm ${
                        m.sender === 'staff' ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-800'
                      }`}
                    >
                      <p>{m.body}</p>
                      <p className={`mt-1 text-[10px] ${m.sender === 'staff' ? 'text-brand-100' : 'text-slate-400'}`}>{timeLabel(m.createdAt)}</p>
                    </div>
                  </div>
                ))}
              </div>

              <form onSubmit={send} className="border-t border-slate-100 p-3">
                {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
                <div className="mb-2 flex items-center gap-1 text-xs">
                  <span className="text-slate-400">Sending as:</span>
                  <button
                    type="button"
                    onClick={() => setDraftSender('staff')}
                    className={`rounded-full px-2.5 py-1 font-medium ${draftSender === 'staff' ? 'bg-brand-100 text-brand-700' : 'text-slate-500 hover:bg-slate-100'}`}
                  >
                    You (staff)
                  </button>
                  <button
                    type="button"
                    onClick={() => setDraftSender('guest')}
                    className={`rounded-full px-2.5 py-1 font-medium ${draftSender === 'guest' ? 'bg-slate-200 text-slate-700' : 'text-slate-500 hover:bg-slate-100'}`}
                    title="Log a message the guest sent you another way (phone/WhatsApp) — there's no live OTA messaging API connected yet"
                  >
                    Guest (log a message)
                  </button>
                </div>
                <div className="flex gap-2">
                  <input
                    className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={draftSender === 'staff' ? 'Type a reply…' : "Log what the guest said…"}
                  />
                  <Button type="submit" disabled={sending || !draft.trim()}>
                    {sending ? 'Sending…' : 'Send'}
                  </Button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>

      {showPicker && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setShowPicker(false)}>
          <div className="max-h-[70vh] w-full max-w-md overflow-y-auto rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-slate-100 px-5 py-4">
              <h3 className="text-sm font-semibold text-slate-900">Start a new message</h3>
              <p className="mt-0.5 text-xs text-slate-500">Active reservations without a conversation yet</p>
            </div>
            {messageable.length === 0 ? (
              <div className="p-4">
                <EmptyState title="No active reservations to message" />
              </div>
            ) : (
              <div className="divide-y divide-slate-50">
                {messageable.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => void startThread(b)}
                    className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-slate-50"
                  >
                    <ChannelIcon source={b.source} className="h-8 w-8" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">{b.guestName}</p>
                      <p className="text-xs text-slate-500">{SOURCE_LABEL[b.source] ?? b.source}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
            <div className="border-t border-slate-100 px-5 py-3 text-right">
              <Button variant="ghost" onClick={() => setShowPicker(false)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
