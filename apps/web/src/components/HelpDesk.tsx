import { useState } from 'react';
import { SUPPORT_CONTACTS } from '../supportContacts';

const AVATAR_COLORS = ['bg-rose-500', 'bg-pink-500', 'bg-emerald-500', 'bg-violet-500', 'bg-amber-500', 'bg-blue-500'];

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <path d="M4 4h16a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2z" />
      <path d="M22 6l-10 7L2 6" />
    </svg>
  );
}

/**
 * Help Desk popover (§ user request, matching a reference product's "Help Center" widget) — the
 * support team roster lives in supportContacts.ts, currently empty since the real names/numbers
 * haven't been shared yet; shows a plain "not set up yet" state instead of the reference's own
 * (not-ours) names until that data arrives.
 */
// §user request — see ThemeToggle.tsx's TONE_CLASS: same banner-only colour override, no circle.
const TONE_CLASS: Record<'light' | 'dark', string> = {
  light: 'text-white hover:bg-white/15 hover:text-white',
  dark: 'text-slate-900 hover:bg-black/10 hover:text-slate-900',
};

export function HelpDesk({ tone }: { tone?: 'light' | 'dark' } = {}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex h-9 w-9 items-center justify-center rounded-full ${tone ? TONE_CLASS[tone] : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'}`}
        aria-label="Help Center"
        title="Help Center"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
          <path d="M3 18v-6a9 9 0 0118 0v6" />
          <path d="M21 19a2 2 0 01-2 2h-1v-6h3zM3 19a2 2 0 002 2h1v-6H3z" />
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-2 w-80 rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800">
            <div className="flex items-start gap-2.5 border-b border-slate-100 px-4 py-3.5 dark:border-slate-700">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400">?</span>
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">Help Center</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Your dedicated support team</p>
              </div>
            </div>

            <div className="max-h-72 overflow-y-auto">
              {SUPPORT_CONTACTS.length === 0 ? (
                <p className="px-4 py-6 text-center text-xs text-slate-400 dark:text-slate-500">Support contacts haven't been set up yet.</p>
              ) : (
                SUPPORT_CONTACTS.map((c, i) => (
                  <div key={c.id} className="flex items-center gap-2.5 border-b border-slate-50 px-4 py-3 last:border-0 dark:border-slate-700/60">
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white ${AVATAR_COLORS[i % AVATAR_COLORS.length]}`}>
                      {c.name.slice(0, 1).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{c.role}</p>
                      <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{c.name}</p>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      {c.phone && (
                        <a
                          href={`tel:${c.phone}`}
                          className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-400 dark:hover:bg-emerald-500/20"
                        >
                          <PhoneIcon />
                        </a>
                      )}
                      {c.email && (
                        <a
                          href={`mailto:${c.email}`}
                          className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-50 text-brand-600 hover:bg-brand-100 dark:bg-brand-500/10 dark:text-brand-400 dark:hover:bg-brand-500/20"
                        >
                          <MailIcon />
                        </a>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="px-4 py-3">
              <button
                type="button"
                disabled={SUPPORT_CONTACTS.length === 0}
                title={SUPPORT_CONTACTS.length === 0 ? 'Add support contacts to supportContacts.ts to enable this' : undefined}
                className="flex w-full items-center justify-center gap-1.5 rounded-full bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Need More Help
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
