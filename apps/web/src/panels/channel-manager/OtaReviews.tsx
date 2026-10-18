import { useEffect, useState } from 'react';
import { query } from '../../api';
import { useAuth } from '../../AuthContext';
import { Button, Card, CardBody, EmptyState, Field, PageHeader, StatCard, inputClass } from '../../components/ui';
import { ChannelBadge } from './ChannelBadge';
import { OTA_CODES, OTA_LABEL } from './ota-labels';
import type { Review } from '../../types';

function todayPlus(days: number) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

/** >=80% of max = clearly good, <50% = needs attention, in between = fine but unremarkable — §
 * user request: "achi review hai to indication, bad hai to indication ki kaam karna hai." */
function sentiment(rating: number, maxRating: number): { label: string; tone: 'good' | 'ok' | 'bad' } {
  const pct = (rating / maxRating) * 100;
  if (pct >= 80) return { label: "Excellent — great for your property's reputation", tone: 'good' };
  if (pct < 50) return { label: 'Needs attention — consider following up with this guest', tone: 'bad' };
  return { label: 'Okay — room to improve', tone: 'ok' };
}

const SENTIMENT_STYLE: Record<'good' | 'ok' | 'bad', string> = {
  good: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200',
  ok: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200',
  bad: 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200',
};

/**
 * OTA Reviews (§ user request) — a pure, read-only report. No manual "Log Review" entry point
 * here on purpose: reviews should arrive automatically once a real OTA review-pull API is
 * connected (same eventual path as Guest Messaging's own live-API gap) — `reviews.create` and
 * `listReviewableBookings` still exist on the backend for whatever that sync ends up calling,
 * just nothing in this UI writes to the table anymore. The only actions per review are "Call"
 * and "Message", which hand off to the phone/Guest Messaging.
 */
export function OtaReviews({ hotelId, onMessageGuest }: { hotelId: string; onMessageGuest: (bookingId: string) => void }) {
  const { token } = useAuth();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [bookingCounts, setBookingCounts] = useState<Record<string, number>>({});
  const [channelFilter, setChannelFilter] = useState('all');
  const [startDate, setStartDate] = useState(todayPlus(-365));
  const [endDate, setEndDate] = useState(todayPlus(0));
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const [r, counts] = await Promise.all([
        query<Review[]>('reviews.list', { hotelId }, token ?? undefined),
        query<Record<string, number>>('reviews.countBookingsBySource', { hotelId }, token ?? undefined),
      ]);
      setReviews(r);
      setBookingCounts(counts);
    }
    void load();
  }, [hotelId, token]);

  // "Specific time ke reviews" (§ user request) — a date-range filter over reviewDate, same From/To
  // convention as Business Reports. Drives both the channel chips below and the list itself, so a
  // chip's own count/average always matches whatever range is currently selected.
  const dateFilteredReviews = reviews.filter((r) => {
    const d = r.reviewDate.slice(0, 10);
    return d >= startDate && d <= endDate;
  });

  const byChannel = OTA_CODES.map((code) => {
    const rows = dateFilteredReviews.filter((r) => r.source === code);
    if (rows.length === 0) return null;
    const avg = rows.reduce((sum, r) => sum + Number(r.rating), 0) / rows.length;
    return { source: code, count: rows.length, avg, maxRating: rows[0].maxRating };
  }).filter((x): x is NonNullable<typeof x> => x !== null);

  const filteredReviews = channelFilter === 'all' ? dateFilteredReviews : dateFilteredReviews.filter((r) => r.source === channelFilter);
  const selectedChannelSummary = channelFilter !== 'all' ? byChannel.find((c) => c.source === channelFilter) : undefined;

  // All-time per channel, not date-filtered — "out of 15 MMT bookings" is a lifetime fact about
  // that channel, the calibration number next to however many reviews fall in the chosen range.
  const totalBookingsAllTime = Object.values(bookingCounts).reduce((sum, n) => sum + n, 0);
  const bookingsDenominator = channelFilter === 'all' ? totalBookingsAllTime : bookingCounts[channelFilter] ?? 0;

  // All-channels view normalizes every review to /10 so mixed scales average fairly; a single
  // channel's own card instead shows that channel's real scale, unnormalized.
  const overallNormalized =
    dateFilteredReviews.length > 0
      ? dateFilteredReviews.reduce((sum, r) => sum + (Number(r.rating) / r.maxRating) * 10, 0) / dateFilteredReviews.length
      : null;

  return (
    <div>
      <PageHeader title="OTA Reviews" subtitle="What guests are saying on each platform, once your OTAs start sharing reviews with StayYatra." />

      <Card className="mb-6">
        <CardBody>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="From">
              <input className={inputClass} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
            <Field label="To">
              <input className={inputClass} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </Field>
          </div>
        </CardBody>
      </Card>

      <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {selectedChannelSummary ? (
          <StatCard
            label={`Rating (${OTA_LABEL[selectedChannelSummary.source] ?? selectedChannelSummary.source})`}
            value={`${selectedChannelSummary.avg.toFixed(1)} / ${selectedChannelSummary.maxRating}`}
            tone="brand"
          />
        ) : (
          <StatCard label="Overall Rating" value={overallNormalized != null ? `${overallNormalized.toFixed(1)} / 10` : '—'} hint="Normalized across every OTA's own scale" tone="brand" />
        )}
        <StatCard
          label="Reviews"
          value={filteredReviews.length}
          hint={`out of ${bookingsDenominator} ${channelFilter === 'all' ? 'total' : OTA_LABEL[channelFilter] ?? channelFilter} booking${bookingsDenominator === 1 ? '' : 's'}`}
        />
      </div>

      {byChannel.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setChannelFilter('all')}
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${channelFilter === 'all' ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-50'}`}
          >
            All channels · {dateFilteredReviews.length}
          </button>
          {byChannel.map((c) => (
            <button
              key={c.source}
              type="button"
              onClick={() => setChannelFilter(c.source)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${
                channelFilter === c.source ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-50'
              }`}
            >
              {OTA_LABEL[c.source] ?? c.source} · {c.count} review{c.count === 1 ? '' : 's'} · {c.avg.toFixed(1)}/{c.maxRating}
            </button>
          ))}
        </div>
      )}

      {filteredReviews.length === 0 ? (
        <Card className="p-8">
          <EmptyState
            title="No reviews yet"
            hint={reviews.length === 0 ? 'Reviews will show up here automatically once your OTAs start sharing them.' : 'No reviews in this date range — try widening it above.'}
          />
        </Card>
      ) : (
        <Card>
          <div className="divide-y divide-slate-100">
            {filteredReviews.map((r) => {
              const sent = sentiment(Number(r.rating), r.maxRating);
              const expanded = expandedId === r.id;
              return (
                <div key={r.id} className="px-5 py-4">
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setExpandedId(expanded ? null : r.id)}
                    onKeyDown={(e) => e.key === 'Enter' && setExpandedId(expanded ? null : r.id)}
                    className="flex cursor-pointer items-start justify-between gap-4"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-slate-900">{r.booking.guestName}</p>
                        <ChannelBadge source={r.source} />
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
                          {Number(r.rating)} / {r.maxRating}
                        </span>
                        <span className="text-xs text-slate-400">{r.reviewDate.slice(0, 10)}</span>
                      </div>
                      {r.reviewText && <p className="mt-1.5 text-sm text-slate-600">{r.reviewText}</p>}
                      <p className={`mt-2 inline-flex rounded-md px-2 py-1 text-xs font-medium ${SENTIMENT_STYLE[sent.tone]}`}>{sent.label}</p>

                      {expanded && (
                        <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-slate-600" onClick={(e) => e.stopPropagation()}>
                          <p className="mb-1 font-semibold uppercase tracking-wide text-slate-400">Guest Reservation Details</p>
                          <p>
                            {r.booking.checkIn.slice(0, 10)} → {r.booking.checkOut.slice(0, 10)} · {r.booking.nights} night{r.booking.nights === 1 ? '' : 's'}
                          </p>
                          <p>{r.booking.guestPhone ?? 'No phone on file'}</p>
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={!r.booking.guestPhone}
                        title={r.booking.guestPhone ?? 'No phone on file'}
                        onClick={() => {
                          if (r.booking.guestPhone) window.location.href = `tel:${r.booking.guestPhone}`;
                        }}
                      >
                        Call
                      </Button>
                      <Button type="button" variant="secondary" onClick={() => onMessageGuest(r.bookingId)}>
                        Message
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
