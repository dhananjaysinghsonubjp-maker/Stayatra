import { useState } from 'react';
import { Button } from './ui';

/** India-first (§ same fixed UTC+5:30 reasoning as Dashboard.tsx's getIstHour) — a plain
 * `new Date().toISOString()` slice gives the wrong calendar day whenever the browser/server
 * isn't itself set to IST (the UTC day flips mid-afternoon IST). Fixed offset instead of relying
 * on device locale. */
export function istDateKey(iso: string): string {
  const istMs = new Date(iso).getTime() + 5.5 * 60 * 60 * 1000;
  return new Date(istMs).toISOString().slice(0, 10);
}
export function istDateLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function addDaysKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
export function dateRangeKeys(from: string, to: string): string[] {
  const out: string[] = [];
  for (let cur = from; cur <= to; cur = addDaysKey(cur, 1)) out.push(cur);
  return out;
}

/** §user request, with an actual Skymax app screenshot as the reference — a From/To range
 * picker with one connected pill spanning the selected days (not separate circles per day).
 * Tap a day to start a new From, tap another to complete To (earlier date always becomes From,
 * swapping if tapped out of order); a third tap starts a fresh range. A single tap-then-Apply
 * with no second tap picks just that one day. Shared by Housekeeping's date filter and the
 * Channel Manager Calendar's view-range picker — same component, same behavior everywhere. */
export function MultiDatePicker({ selected, onApply, onClose }: { selected: string[]; onApply: (dates: string[]) => void; onClose: () => void }) {
  const [from, setFrom] = useState(selected[0] ?? istDateKey(new Date().toISOString()));
  const [to, setTo] = useState(selected[selected.length - 1] ?? from);
  const [viewDate, setViewDate] = useState(() => new Date(`${from}T00:00:00`));

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => `${year}-${String(month + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`)];

  function tapDay(dateKey: string) {
    if (!from || to) {
      // nothing picked yet, or a complete range already exists — start a fresh one
      setFrom(dateKey);
      setTo('');
    } else if (dateKey < from) {
      setTo(from);
      setFrom(dateKey);
    } else {
      setTo(dateKey);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-2xl bg-white p-4 pb-6 dark:bg-slate-800 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center">
          <button onClick={onClose} className="text-xl text-slate-500 dark:text-slate-400">
            ‹
          </button>
          <h3 className="flex-1 text-center text-base font-bold text-slate-900 dark:text-white">Date</h3>
          <span className="w-5" />
        </div>

        <div className="mb-4 flex items-start gap-10">
          <div>
            <p className="text-xs text-slate-400 dark:text-slate-500">From</p>
            <p className="text-base font-bold text-slate-900 dark:text-white">{istDateLabel(from)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400 dark:text-slate-500">To</p>
            <p className="text-base font-bold text-slate-900 dark:text-white">{to ? istDateLabel(to) : '—'}</p>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
          <div className="mb-3 flex items-center justify-between">
            <button
              onClick={() => setViewDate(new Date(year, month - 1, 1))}
              className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
            >
              ‹
            </button>
            <p className="text-sm font-bold text-slate-900 dark:text-white">
              {viewDate.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
            </p>
            <button
              onClick={() => setViewDate(new Date(year, month + 1, 1))}
              className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
            >
              ›
            </button>
          </div>

          <div className="mb-1 grid grid-cols-7 text-center text-[11px] font-medium text-slate-400 dark:text-slate-500">
            {WEEKDAY_LABELS.map((w) => (
              <div key={w} className="py-1">
                {w}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((dateKey, i) => {
              if (!dateKey) return <div key={`blank-${i}`} className="py-1" />;
              const day = Number(dateKey.slice(-2));
              const rangeEnd = to || from;
              const inRange = dateKey >= from && dateKey <= rangeEnd;
              const dow = i % 7;
              const roundedLeft = dateKey === from || dow === 0;
              const roundedRight = dateKey === rangeEnd || dow === 6;
              return (
                <div key={dateKey} className={`py-1 ${inRange ? 'bg-brand-600' : ''} ${roundedLeft ? 'rounded-l-full' : ''} ${roundedRight ? 'rounded-r-full' : ''}`}>
                  <button onClick={() => tapDay(dateKey)} className={`flex h-9 w-9 items-center justify-center rounded-full text-sm ${inRange ? 'font-bold text-white' : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700'}`}>
                    {day}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <Button className="mt-4 w-full" onClick={() => onApply(dateRangeKeys(from, to || from))}>
          Apply
        </Button>
      </div>
    </div>
  );
}

export function DateFilterPill({ selected, onChange }: { selected: string[]; onChange: (dates: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const label =
    selected.length === 0
      ? 'Select dates'
      : selected.length === 1
        ? istDateLabel(selected[0])
        : `${istDateLabel(selected[0])} – ${istDateLabel(selected[selected.length - 1])}`;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3.5 py-2 shadow-sm dark:border-slate-600 dark:bg-slate-800"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
        <span className="text-sm font-bold text-brand-700 dark:text-brand-300">{label}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-3.5 w-3.5 shrink-0 text-slate-400">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <MultiDatePicker
          selected={selected}
          onClose={() => setOpen(false)}
          onApply={(dates) => {
            onChange(dates);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
