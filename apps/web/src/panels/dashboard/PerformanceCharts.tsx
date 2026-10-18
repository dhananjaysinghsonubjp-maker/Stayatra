import { useState } from 'react';
import { useTheme } from '../../ThemeContext';
import type { Booking } from '../../types';

// SVG colours below use `var(--color-brand-600)` (not a literal hex) so a hotel's own brand
// colour (Settings → Hotel Details, see brandColor.ts) re-themes these charts too — SVG
// presentation attributes resolve CSS custom properties the same as any other CSS colour value.

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number) {
  return new Date(d.getTime() + n * 86400000);
}

function sameDay(a: Date, b: Date) {
  return a.toDateString() === b.toDateString();
}

/** Daily {revenue, bookings} for the `days` calendar days ending today, oldest first — the
 * shared data shape behind both the trend line and the heatmap below. Keyed off `createdAt`
 * (money booked that day), same convention as the Performance Overview cards above it. */
function dailySeries(bookings: Booking[], days: number) {
  const active = bookings.filter((b) => b.status !== 'cancelled');
  const today = startOfDay(new Date());
  const start = addDays(today, -(days - 1));
  const series: { date: Date; revenue: number; bookings: number }[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(start, i);
    const onDay = active.filter((b) => sameDay(new Date(b.createdAt), date));
    series.push({ date, revenue: onDay.reduce((s, b) => s + Number(b.totalAmount), 0), bookings: onDay.length });
  }
  return series;
}

function formatCompactInr(n: number) {
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${Math.round(n)}`;
}

/** Live room status donut (§ user request, matching a reference dashboard widget) — PMS-only, since a Channel-Manager-only org has no physical rooms to show occupancy for. */
export function OccupancyDonut({ total, occupied }: { total: number; occupied: number }) {
  const { theme } = useTheme();
  const available = Math.max(0, total - occupied);
  const pct = total > 0 ? Math.round((occupied / total) * 100) : 0;
  const radius = 80;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;
  const trackColor = theme === 'dark' ? '#334155' : '#e2e8f0';

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-base font-bold text-slate-900 dark:text-white">Occupancy Overview</h3>
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Live
        </span>
      </div>
      <p className="mb-4 text-xs text-slate-400 dark:text-slate-500">Live room status</p>

      <div className="relative mx-auto flex h-48 w-48 items-center justify-center">
        <svg viewBox="0 0 200 200" className="h-full w-full -rotate-90">
          <circle cx="100" cy="100" r={radius} fill="none" stroke={trackColor} strokeWidth="22" />
          {total > 0 && (
            <circle
              cx="100"
              cy="100"
              r={radius}
              fill="none"
              stroke="var(--color-brand-600)"
              strokeWidth="22"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              style={{ transition: 'stroke-dashoffset 0.6s ease' }}
            />
          )}
        </svg>
        <div className="absolute flex flex-col items-center">
          <p className="text-sm text-slate-400 dark:text-slate-500">Occupancy</p>
          <p className="text-4xl font-bold text-slate-900 dark:text-white">{pct}%</p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-slate-50 py-2.5 dark:bg-slate-700/50">
          <p className="text-xs text-slate-400 dark:text-slate-400">Total</p>
          <p className="text-lg font-bold text-slate-900 dark:text-white">{total}</p>
        </div>
        <div className="rounded-lg bg-emerald-50 py-2.5 dark:bg-emerald-500/10">
          <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Occupied</p>
          <p className="text-lg font-bold text-emerald-700 dark:text-emerald-400">{occupied}</p>
        </div>
        <div className="rounded-lg bg-brand-50 py-2.5 dark:bg-brand-500/10">
          <p className="text-xs font-medium text-brand-600 dark:text-brand-400">Available</p>
          <p className="text-lg font-bold text-brand-700 dark:text-brand-400">{available}</p>
        </div>
      </div>
    </div>
  );
}

/** Last-15-days revenue + bookings line (§ user request, matching a reference dashboard widget), hover for a per-day tooltip. */
export function RevenueTrendChart({ bookings }: { bookings: Booking[] }) {
  const { theme } = useTheme();
  const series = dailySeries(bookings, 15);
  const [hover, setHover] = useState<number | null>(null);
  const gridColor = theme === 'dark' ? '#334155' : '#f1f5f9';
  const dotStroke = theme === 'dark' ? '#1e293b' : 'white';

  const width = 760;
  const height = 240;
  const padL = 56;
  const padR = 12;
  const padT = 12;
  const padB = 28;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const maxRevenue = Math.max(1, ...series.map((s) => s.revenue));
  const niceMax = Math.ceil(maxRevenue / 50000) * 50000 || 50000;
  const x = (i: number) => padL + (i / (series.length - 1)) * plotW;
  const y = (v: number) => padT + plotH - (v / niceMax) * plotH;

  const linePath = series.map((s, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(s.revenue)}`).join(' ');
  const areaPath = `${linePath} L ${x(series.length - 1)} ${padT + plotH} L ${x(0)} ${padT + plotH} Z`;

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(niceMax * f));
  const active = hover != null ? series[hover] : null;

  return (
    <div className="relative rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-slate-900 dark:text-white">Revenue Trend</h3>
          <p className="text-xs text-slate-400 dark:text-slate-500">Last 15 Days Performance</p>
        </div>
        <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700 dark:bg-brand-500/10 dark:text-brand-400">Live Analytics</span>
      </div>

      <div className="mb-3 flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-brand-600" /> Revenue
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Bookings
        </span>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="w-full overflow-visible">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={width - padR} y1={y(t)} y2={y(t)} stroke={gridColor} strokeWidth="1" />
            <text x={padL - 8} y={y(t) + 4} textAnchor="end" className="fill-slate-400 text-[10px] dark:fill-slate-500">
              {formatCompactInr(t)}
            </text>
          </g>
        ))}

        <defs>
          <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-brand-600)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--color-brand-600)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#revFill)" />
        <path d={linePath} fill="none" stroke="var(--color-brand-600)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />

        {series.map((s, i) => (
          <circle key={i} cx={x(i)} cy={y(s.revenue)} r={hover === i ? 5 : 3} fill="var(--color-brand-600)" stroke={dotStroke} strokeWidth="1.5" />
        ))}

        {series.map((_, i) => (
          <rect
            key={i}
            x={x(i) - plotW / series.length / 2}
            y={padT}
            width={plotW / series.length}
            height={plotH}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover((h) => (h === i ? null : h))}
          />
        ))}

        {series.map((s, i) => (
          <text key={i} x={x(i)} y={height - 8} textAnchor="middle" className="fill-slate-400 text-[10px] dark:fill-slate-500">
            {String(s.date.getDate()).padStart(2, '0')}
          </text>
        ))}
      </svg>

      {active && hover != null && (
        <div
          className="pointer-events-none absolute z-10 w-44 rounded-xl border border-slate-200 bg-white p-3 shadow-lg dark:border-slate-700 dark:bg-slate-800"
          style={{ left: `${Math.min(85, Math.max(5, (x(hover) / width) * 100))}%`, top: 36, transform: 'translateX(-50%)' }}
        >
          <p className="mb-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">{String(active.date.getDate()).padStart(2, '0')} {active.date.toLocaleDateString('en-IN', { month: 'short' })}</p>
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
              <span className="h-2 w-2 rounded-full bg-brand-600" /> Revenue
            </span>
            <span className="font-semibold text-slate-900 dark:text-white">₹{active.revenue.toLocaleString('en-IN')}</span>
          </div>
          <div className="mt-1 flex items-center justify-between text-sm">
            <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
              <span className="h-2 w-2 rounded-full bg-emerald-500" /> Bookings
            </span>
            <span className="font-semibold text-slate-900 dark:text-white">{active.bookings}</span>
          </div>
        </div>
      )}
    </div>
  );
}

const HEAT_LEVELS = [
  { max: 0, cls: 'bg-slate-100 dark:bg-slate-700' },
  { max: 0.33, cls: 'bg-indigo-200 dark:bg-indigo-900' },
  { max: 0.66, cls: 'bg-indigo-400 dark:bg-indigo-600' },
  { max: Infinity, cls: 'bg-indigo-600 dark:bg-indigo-400' },
];

function heatClass(revenue: number, max: number) {
  if (revenue <= 0 || max <= 0) return HEAT_LEVELS[0].cls;
  const ratio = revenue / max;
  for (const level of HEAT_LEVELS) {
    if (ratio <= level.max) return level.cls;
  }
  return HEAT_LEVELS[HEAT_LEVELS.length - 1].cls;
}

function mondayOnOrBefore(d: Date) {
  const date = startOfDay(d);
  const day = date.getDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(date, diff);
}

/** Calendar-aligned revenue heatmap, last ~35 days (§ user request, matching a reference dashboard widget) — weeks as rows so Mon..Sun line up as real calendar columns, not just "every 7th raw day." */
export function RevenueHeatmap({ bookings }: { bookings: Booking[] }) {
  const today = startOfDay(new Date());
  const approxStart = addDays(today, -34);
  const gridStart = mondayOnOrBefore(approxStart);
  const totalDays = Math.round((today.getTime() - gridStart.getTime()) / 86400000) + 1;
  const weeks = Math.ceil(totalDays / 7);

  const series = dailySeries(bookings, Math.round((today.getTime() - gridStart.getTime()) / 86400000) + 1);
  const byDate = new Map(series.map((s) => [s.date.toDateString(), s]));
  const maxRevenue = Math.max(0, ...series.map((s) => s.revenue));

  const monthLabel = today.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-base font-bold text-slate-900 dark:text-white">Revenue Heatmap</h3>
        <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">{monthLabel}</span>
      </div>
      <p className="mb-4 text-xs text-slate-400 dark:text-slate-500">Last 35 days revenue activity</p>

      <div className="grid grid-cols-7 gap-1.5 text-center">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <span key={d} className="text-[11px] font-medium text-slate-400 dark:text-slate-500">
            {d}
          </span>
        ))}
        {Array.from({ length: weeks }).map((_, week) =>
          Array.from({ length: 7 }).map((__, weekday) => {
            const date = addDays(gridStart, week * 7 + weekday);
            if (date > today) return <span key={`${week}-${weekday}`} />;
            const entry = byDate.get(date.toDateString());
            const revenue = entry?.revenue ?? 0;
            return (
              <div key={`${week}-${weekday}`} className="flex justify-center">
                <div
                  title={`${date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} — ₹${revenue.toLocaleString('en-IN')}`}
                  className={`h-6 w-6 rounded-md ${heatClass(revenue, maxRevenue)}`}
                />
              </div>
            );
          }),
        )}
      </div>

      <div className="mt-4 flex items-center justify-end gap-1.5 text-xs text-slate-400 dark:text-slate-500">
        <span>Less</span>
        {HEAT_LEVELS.map((l) => (
          <span key={l.cls} className={`h-3.5 w-3.5 rounded ${l.cls}`} />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}
