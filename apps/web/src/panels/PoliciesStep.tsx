import { useState } from 'react';
import { Button } from '../components/ui';
import { StepTabs } from './ListingWizardTabs';

export type CancellationPolicy = 'free_till_checkin' | 'free_24h' | 'free_48h' | 'free_72h' | 'non_refundable';

export interface PoliciesInfo {
  checkInTime: string;
  checkOutTime: string;
  cancellationPolicy: CancellationPolicy;
  allowUnmarriedCouples: boolean | null;
}

function timeOptions() {
  const opts: { value: string; label: string }[] = [];
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 30]) {
      const value = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      let label: string;
      if (h === 0 && m === 0) label = '12:00 am (midnight)';
      else if (h === 12 && m === 0) label = '12:00 pm (noon)';
      else {
        const period = h < 12 ? 'am' : 'pm';
        const h12 = h % 12 === 0 ? 12 : h % 12;
        label = `${h12}:${String(m).padStart(2, '0')} ${period}`;
      }
      opts.push({ value, label });
    }
  }
  return opts;
}
const TIME_OPTIONS = timeOptions();

const CANCELLATION_OPTIONS: { value: CancellationPolicy; label: string; hours: number | null; refundBoundaryPct: number }[] = [
  { value: 'free_till_checkin', label: 'Free Cancellation till check-in', hours: null, refundBoundaryPct: 96 },
  { value: 'free_24h', label: 'Free Cancellation till 24 hours before check-in', hours: 24, refundBoundaryPct: 85 },
  { value: 'free_48h', label: 'Free Cancellation till 48 hours before check-in', hours: 48, refundBoundaryPct: 77 },
  { value: 'free_72h', label: 'Free Cancellation till 72 hours before check-in', hours: 72, refundBoundaryPct: 70 },
];

function RefundTimeline({ option }: { option: (typeof CANCELLATION_OPTIONS)[number] }) {
  return (
    <div className="mt-3 rounded-lg bg-slate-50 p-4">
      <div className="flex justify-between px-1 text-xs text-slate-600">
        <span>100% Refund</span>
        <span>Non-refundable</span>
      </div>
      <div className="relative mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-200">
        <div className="absolute inset-y-0 left-0 bg-amber-500" style={{ width: `${option.refundBoundaryPct}%` }} />
      </div>
      <div className="mt-1.5 flex justify-between text-xs">
        <span className="font-medium text-slate-700">Booking Date</span>
        {option.hours && (
          <span className="text-center text-slate-500" style={{ marginLeft: `${option.refundBoundaryPct - 50}%` }}>
            {option.hours} hours before
            <br />
            check-in
          </span>
        )}
        <span className="font-medium text-slate-700">Check-in</span>
      </div>
    </div>
  );
}

export function PoliciesStep({
  initial,
  rateplanCount = 1,
  onContinue,
  onBack,
  busy = false,
  serverError = null,
}: {
  initial?: Partial<PoliciesInfo>;
  rateplanCount?: number;
  onContinue: (info: PoliciesInfo) => void;
  onBack: () => void;
  busy?: boolean;
  serverError?: string | null;
}) {
  const [checkInTime, setCheckInTime] = useState(initial?.checkInTime ?? '12:00');
  const [checkOutTime, setCheckOutTime] = useState(initial?.checkOutTime ?? '12:00');
  const [cancellationPolicy, setCancellationPolicy] = useState<CancellationPolicy>(initial?.cancellationPolicy ?? 'free_till_checkin');
  const [allowUnmarriedCouples, setAllowUnmarriedCouples] = useState<boolean | null>(initial?.allowUnmarriedCouples ?? null);
  const [guestProfileOpen, setGuestProfileOpen] = useState(true);

  const rulesAdded = allowUnmarriedCouples !== null ? 1 : 0;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    onContinue({ checkInTime, checkOutTime, cancellationPolicy, allowUnmarriedCouples });
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-white">
      <StepTabs current={4} />
      <form onSubmit={submit} className="mx-auto w-full max-w-3xl flex-1 px-10 py-8">
        <h1 className="text-2xl font-bold text-slate-900">Policies</h1>
        <p className="mb-6 mt-1 text-sm text-slate-500">Mention all the policies applicable at your property.</p>

        <div className="mb-6 rounded-xl border border-slate-200">
          <div className="border-b border-slate-100 px-6 py-5">
            <h2 className="text-lg font-semibold text-slate-900">Check-in &amp; Check-out Time</h2>
            <p className="mt-0.5 text-sm text-slate-500">Specify the check-in &amp; check-out time at your property</p>
          </div>
          <div className="grid grid-cols-2 gap-6 px-6 py-5">
            <div>
              <p className="mb-1.5 text-xs font-medium text-slate-600">Check-in Time</p>
              <select
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                value={checkInTime}
                onChange={(e) => setCheckInTime(e.target.value)}
              >
                {TIME_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <p className="mb-1.5 text-xs font-medium text-slate-600">Check-out Time</p>
              <select
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                value={checkOutTime}
                onChange={(e) => setCheckOutTime(e.target.value)}
              >
                {TIME_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="mb-6 rounded-xl border border-slate-200">
          <div className="border-b border-slate-100 px-6 py-5">
            <h2 className="text-lg font-semibold text-slate-900">Cancellation Policy</h2>
            <p className="mt-0.5 text-sm text-slate-500">Offering a flexible cancellation policy helps traveller book in advance.</p>
          </div>
          <div className="space-y-3 px-6 py-5">
            {CANCELLATION_OPTIONS.map((o) => (
              <div key={o.value}>
                <label className="flex items-center gap-2.5 text-sm text-slate-800">
                  <input
                    type="radio"
                    name="cancellationPolicy"
                    className="h-4 w-4 border-slate-300 text-brand-600 focus:ring-brand-500"
                    checked={cancellationPolicy === o.value}
                    onChange={() => setCancellationPolicy(o.value)}
                  />
                  {o.label}
                  {o.value === 'free_till_checkin' && (
                    <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">RECOMMENDED</span>
                  )}
                </label>
                {cancellationPolicy === o.value && <RefundTimeline option={o} />}
              </div>
            ))}
            <label className="flex items-center gap-2.5 text-sm text-slate-800">
              <input
                type="radio"
                name="cancellationPolicy"
                className="h-4 w-4 border-slate-300 text-brand-600 focus:ring-brand-500"
                checked={cancellationPolicy === 'non_refundable'}
                onChange={() => setCancellationPolicy('non_refundable')}
              />
              Non-Refundable
            </label>
          </div>
          <div className="mx-6 mb-5 flex items-start gap-2 rounded-lg bg-brand-50 px-3 py-2.5 text-xs text-brand-700">
            <span>ℹ️</span>
            <span>
              Selected policy would be applicable to {rateplanCount} rateplan{rateplanCount === 1 ? '' : 's'} created. You can modify
              this policy after completing the listing.
            </span>
          </div>
        </div>

        <div className="mb-6 rounded-xl border border-slate-200">
          <div className="border-b border-slate-100 px-6 py-5">
            <h2 className="text-lg font-semibold text-slate-900">
              Property Rules <span className="font-normal text-slate-400">(optional)</span>
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">Add property rules basis the requirement of your property listing</p>
          </div>
          <div className="px-6 py-4">
            <button
              type="button"
              onClick={() => setGuestProfileOpen((v) => !v)}
              className="flex w-full items-center justify-between py-1 text-left"
            >
              <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                🧑‍🤝‍🧑 Guest Profile
                <span
                  className={`rounded px-2 py-0.5 text-xs font-medium ${
                    rulesAdded > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
                  }`}
                >
                  {rulesAdded}/1 RULES ADDED
                </span>
              </span>
              <span className="text-slate-400">{guestProfileOpen ? '▲' : '▼'}</span>
            </button>
            {guestProfileOpen && (
              <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
                <p className="text-sm text-slate-700">Do you allow unmarried couples?</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setAllowUnmarriedCouples(false)}
                    className={`rounded-full border px-4 py-1.5 text-sm font-medium ${
                      allowUnmarriedCouples === false
                        ? 'border-brand-600 bg-brand-50 text-brand-700'
                        : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    No
                  </button>
                  <button
                    type="button"
                    onClick={() => setAllowUnmarriedCouples(true)}
                    className={`rounded-full border px-4 py-1.5 text-sm font-medium ${
                      allowUnmarriedCouples === true
                        ? 'border-brand-600 bg-brand-50 text-brand-700'
                        : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    Yes
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {serverError && <p className="mb-4 text-sm text-red-600">{serverError}</p>}

        <div className="flex items-center justify-between pb-8">
          <Button type="button" variant="ghost" onClick={onBack} disabled={busy}>
            ← Back
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save and Continue'}
          </Button>
        </div>
      </form>
    </div>
  );
}
