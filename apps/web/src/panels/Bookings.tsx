import { useEffect, useMemo, useState } from 'react';
import { mutate, query, ApiError } from '../api';
import { useAuth } from '../AuthContext';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, PageHeader, inputClass } from '../components/ui';
import { CheckInModal } from './checkin/CheckInModal';
import { AddPaymentModal } from './AddPaymentModal';
import { BookingViewModal } from './BookingViewModal';
import { computeInvoiceTotals } from '../invoice';
import { SOURCE_LABEL } from './channel-manager/ota-labels';
import { ChannelBadge } from './channel-manager/ChannelBadge';
import type { Booking, OtaConnection, RoomCategory } from '../types';

function todayPlus(days: number) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

export function Bookings({ hotelId, hasPms = true }: { hotelId: string; hasPms?: boolean }) {
  const { token } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [categories, setCategories] = useState<RoomCategory[]>([]);
  const [connections, setConnections] = useState<OtaConnection[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [payingBooking, setPayingBooking] = useState<Booking | null>(null);
  const [checkingInBooking, setCheckingInBooking] = useState<Booking | null>(null);
  const [viewingBooking, setViewingBooking] = useState<Booking | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [sourceFilter, setSourceFilter] = useState('all');
  const [view, setView] = useState<'list' | 'calendar'>('list');
  const [focusedDate, setFocusedDate] = useState<string | null>(null);

  async function refresh() {
    try {
      const [b, c, conns] = await Promise.all([
        query<Booking[]>('bookings.listReservations', { hotelId }, token ?? undefined),
        query<RoomCategory[]>('hotels.listRoomCategories', { hotelId }, token ?? undefined),
        query<OtaConnection[]>('ota.listConnections', { hotelId }, token ?? undefined),
      ]);
      setBookings(b);
      setCategories(c);
      setConnections(conns);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load reservations');
    }
  }
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId]);

  const filtered = useMemo(() => {
    let rows = sourceFilter === 'all' ? bookings : bookings.filter((b) => b.source === sourceFilter);
    if (focusedDate) rows = rows.filter((b) => b.checkIn.slice(0, 10) === focusedDate);
    return rows;
  }, [bookings, sourceFilter, focusedDate]);

  async function cancelBooking(bookingId: string) {
    if (!confirm('Cancel this reservation? This cannot be undone.')) return;
    try {
      await mutate('bookings.cancelBooking', { bookingId }, token ?? undefined);
      void refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to cancel');
    }
  }

  /**
   * §7 Phase 1 #11's "instant booking notification" needs something to
   * receive — no real OTA webhook exists yet, so this demo trigger lets an
   * owner see the notification bell fire today instead of only once a real
   * channel is wired in.
   */
  async function simulateBooking() {
    const connection = connections[0];
    const category = categories[0];
    if (!connection || !category) return;
    try {
      await mutate(
        'bookings.simulateInboundBooking',
        {
          hotelId,
          otaConnectionId: connection.id,
          source: connection.otaCode,
          guestName: 'Demo Guest',
          roomCategoryId: category.id,
          checkIn: todayPlus(7),
          checkOut: todayPlus(9),
          nights: 2,
          totalAmount: 4500,
        },
        token ?? undefined,
      );
      void refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to simulate booking');
    }
  }

  return (
    <div>
      <PageHeader
        title="Reservations"
        subtitle={hasPms ? `${bookings.length} total — every channel, plus direct/walk-in bookings` : `${bookings.length} total — every connected channel, automatically`}
        action={
          <div className="flex gap-2">
            <Button onClick={() => setView(view === 'list' ? 'calendar' : 'list')} variant="secondary">
              {view === 'list' ? 'Calendar view' : 'List view'}
            </Button>
            {connections.length > 0 && categories.length > 0 && (
              <Button onClick={simulateBooking} variant="secondary">
                Simulate incoming booking
              </Button>
            )}
            {connections.length > 0 && (
              <Button onClick={() => setShowImport((v) => !v)} variant="secondary">
                Import historical
              </Button>
            )}
            {/* Channel Manager's whole point is that a reservation only ever gets here from a real
                channel (or, on the PMS side, a walk-in checked in at the desk) — no manual "type in a
                booking" entry point, or every OTA's inventory math would be one guess away from wrong. */}
            {hasPms && (
              <Button onClick={() => setShowForm((v) => !v)} variant={showForm ? 'secondary' : 'primary'}>
                {showForm ? 'Cancel' : '+ New reservation'}
              </Button>
            )}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Field label="Channel">
          <select className={inputClass} value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
            <option value="all">All channels</option>
            {Object.entries(SOURCE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        {focusedDate && (
          <button onClick={() => setFocusedDate(null)} className="mt-5 text-xs font-medium text-brand-600 hover:underline">
            Clear date filter ({focusedDate}) ×
          </button>
        )}
      </div>

      {showImport && (
        <div className="mb-6">
          <ImportHistoricalForm
            hotelId={hotelId}
            connections={connections}
            categories={categories}
            onDone={() => {
              void refresh();
              setShowImport(false);
            }}
          />
        </div>
      )}

      {showForm && hasPms && (
        <div className="mb-6">
          <ManualBookingForm
            hotelId={hotelId}
            categories={categories}
            onDone={() => {
              void refresh();
              setShowForm(false);
            }}
          />
        </div>
      )}

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {view === 'calendar' ? (
        <MiniCalendar bookings={bookings} focusedDate={focusedDate} onSelectDate={setFocusedDate} />
      ) : (
        <Card>
          {filtered.length === 0 ? (
            <CardBody>
              <EmptyState title="No reservations match" />
            </CardBody>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs font-medium text-slate-500">
                    <th className="px-5 py-3">Guest</th>
                    <th className="px-5 py-3">Dates</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Channel</th>
                    <th className="px-5 py-3">Paid / Total</th>
                    <th className="px-5 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((b) => {
                    const totals = computeInvoiceTotals({
                      totalAmount: Number(b.totalAmount),
                      lineItems: b.lineItems ?? [],
                      discountAmount: b.discountAmount ? Number(b.discountAmount) : null,
                      gstExempt: b.gstExempt,
                    });
                    const outstanding = totals.grandTotal - Number(b.paidAmount ?? 0);
                    return (
                      <tr key={b.id} className="hover:bg-slate-50">
                        <td className="px-5 py-3 font-medium text-slate-900">{b.guestName}</td>
                        <td className="px-5 py-3 text-slate-500">
                          {b.checkIn.slice(0, 10)} → {b.checkOut.slice(0, 10)}
                        </td>
                        <td className="px-5 py-3">
                          <Badge tone={b.status}>{b.status}</Badge>
                        </td>
                        <td className="px-5 py-3 text-slate-500">
                          <ChannelBadge source={b.source} />
                        </td>
                        <td className="px-5 py-3">
                          <span className="text-slate-900">₹{b.paidAmount ?? 0}</span>
                          <span className="text-slate-400"> / ₹{totals.grandTotal.toFixed(2)}</span>
                          {outstanding > 0 ? (
                            <span className="ml-1.5 text-xs text-amber-600">₹{outstanding} due</span>
                          ) : (
                            <span className="ml-1.5 text-xs text-emerald-600">paid in full</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <div className="flex justify-end gap-3">
                            {hasPms ? (
                              <>
                                {b.status === 'confirmed' && (
                                  <button onClick={() => setCheckingInBooking(b)} className="text-xs font-medium text-brand-600 hover:underline">
                                    Check in
                                  </button>
                                )}
                                {b.status === 'confirmed' && (
                                  <button onClick={() => cancelBooking(b.id)} className="text-xs font-medium text-red-600 hover:underline">
                                    Cancel
                                  </button>
                                )}
                                {outstanding > 0 && (
                                  <button onClick={() => setPayingBooking(b)} className="text-xs font-medium text-brand-600 hover:underline">
                                    Add payment
                                  </button>
                                )}
                              </>
                            ) : (
                              // Channel Manager only: bookings and their cancellations arrive automatically through the
                              // channel (or its simulator, until a real API is live) — nothing here to add or cancel by hand.
                              <button onClick={() => setViewingBooking(b)} className="text-xs font-medium text-brand-600 hover:underline">
                                View
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {payingBooking && (
        <AddPaymentModal booking={payingBooking} onClose={() => setPayingBooking(null)} onDone={refresh} />
      )}
      {checkingInBooking && (
        <CheckInModal hotelId={hotelId} reservation={checkingInBooking} onClose={() => setCheckingInBooking(null)} onDone={refresh} />
      )}
      {viewingBooking && <BookingViewModal booking={viewingBooking} onClose={() => setViewingBooking(null)} />}
    </div>
  );
}

/** A compact month grid — check-in counts per day, click a day to filter the list below (§7 Phase 1 #5's "calendar of bookings"). */
function MiniCalendar({
  bookings,
  focusedDate,
  onSelectDate,
}: {
  bookings: Booking[];
  focusedDate: string | null;
  onSelectDate: (date: string | null) => void;
}) {
  const [monthOffset, setMonthOffset] = useState(0);
  const base = new Date();
  base.setUTCDate(1);
  base.setUTCMonth(base.getUTCMonth() + monthOffset);

  const countsByDate = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of bookings) {
      const key = b.checkIn.slice(0, 10);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [bookings]);

  const year = base.getUTCFullYear();
  const month = base.getUTCMonth();
  const firstDow = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: (string | null)[] = [...Array(firstDow).fill(null)];
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(new Date(Date.UTC(year, month, d)).toISOString().slice(0, 10));
  }

  return (
    <Card>
      <CardBody>
        <div className="mb-4 flex items-center justify-between">
          <button onClick={() => setMonthOffset((m) => m - 1)} className="rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-100">
            ← Prev
          </button>
          <p className="text-sm font-semibold text-slate-900">{base.toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</p>
          <button onClick={() => setMonthOffset((m) => m + 1)} className="rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-100">
            Next →
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-slate-400">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
            <div key={d}>{d}</div>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {cells.map((date, i) => {
            if (!date) return <div key={i} />;
            const count = countsByDate.get(date) ?? 0;
            const isFocused = focusedDate === date;
            return (
              <button
                key={date}
                onClick={() => onSelectDate(isFocused ? null : date)}
                className={`flex h-16 flex-col items-center justify-start rounded-md border p-1 text-xs ${
                  isFocused ? 'border-brand-500 bg-brand-50' : 'border-slate-100 hover:bg-slate-50'
                }`}
              >
                <span className="text-slate-600">{date.slice(8, 10)}</span>
                {count > 0 && (
                  <span className="mt-1 rounded-full bg-brand-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">{count}</span>
                )}
              </button>
            );
          })}
        </div>
      </CardBody>
    </Card>
  );
}

function ImportHistoricalForm({
  hotelId,
  connections,
  categories,
  onDone,
}: {
  hotelId: string;
  connections: OtaConnection[];
  categories: RoomCategory[];
  onDone: () => void;
}) {
  const { token } = useAuth();
  const [otaConnectionId, setOtaConnectionId] = useState(connections[0]?.id ?? '');
  const [csv, setCsv] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    const connection = connections.find((c) => c.id === otaConnectionId);
    if (!connection) {
      setError('Select a channel first');
      return;
    }
    const lines = csv.split('\n').map((l) => l.trim()).filter(Boolean);
    try {
      const rows = lines.map((line) => {
        const [guestName, guestPhone, categoryName, checkIn, checkOut, nights, totalAmount, otaBookingRef] = line.split(',').map((v) => v.trim());
        const category = categories.find((c) => c.name.toLowerCase() === (categoryName ?? '').toLowerCase());
        if (!category) throw new Error(`Unknown room category "${categoryName}" in row: ${line}`);
        return {
          guestName,
          guestPhone: guestPhone || undefined,
          roomCategoryId: category.id,
          checkIn,
          checkOut,
          nights: Number(nights),
          totalAmount: Number(totalAmount),
          otaBookingRef: otaBookingRef || undefined,
        };
      });
      const res = await mutate<{ imported: number }>(
        'bookings.importHistoricalBookings',
        { hotelId, otaConnectionId, source: connection.otaCode, rows },
        token ?? undefined,
      );
      setResult(`Imported ${res.imported} bookings.`);
      setCsv('');
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Import failed');
    }
  }

  return (
    <Card>
      <CardHeader
        title="Import historical bookings"
        subtitle="One-time import from a channel's own extranet export (§7 Phase 1 #5) — no live OTA connectivity exists yet, so paste rows here."
      />
      <CardBody>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Channel these bookings came from">
            <select className={inputClass} value={otaConnectionId} onChange={(e) => setOtaConnectionId(e.target.value)} required>
              <option value="">— select —</option>
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.otaCode}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Rows — one per line: guest name, phone, room category name, check-in (YYYY-MM-DD), check-out, nights, total amount, booking ref (optional)">
            <textarea
              className={`${inputClass} h-32 font-mono text-xs`}
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              placeholder="Rahul Sharma,9876543210,Deluxe Double,2026-08-01,2026-08-03,2,4500,MMT-12345"
              required
            />
          </Field>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {result && <p className="text-sm text-emerald-600">{result}</p>}
          <Button type="submit" variant="secondary">
            Import rows
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

function ManualBookingForm({
  hotelId,
  categories,
  onDone,
}: {
  hotelId: string;
  categories: RoomCategory[];
  onDone: () => void;
}) {
  const { token } = useAuth();
  const [guestName, setGuestName] = useState('');
  const [roomCategoryId, setRoomCategoryId] = useState('');
  const [checkIn, setCheckIn] = useState(todayPlus(3));
  const [checkOut, setCheckOut] = useState(todayPlus(5));
  const [nights, setNights] = useState(2);
  const [totalAmount, setTotalAmount] = useState(4000);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await mutate(
        'bookings.createManualBooking',
        { hotelId, guestName, roomCategoryId, checkIn, checkOut, nights, totalAmount },
        token ?? undefined,
      );
      setGuestName('');
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create booking');
    }
  }

  return (
    <Card>
      <CardHeader title="New reservation" subtitle="Future-dated — the guest checks in normally on arrival (§8.4)" />
      <CardBody>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field label="Guest name">
              <input className={inputClass} value={guestName} onChange={(e) => setGuestName(e.target.value)} required />
            </Field>
            <Field label="Room category">
              <select className={inputClass} value={roomCategoryId} onChange={(e) => setRoomCategoryId(e.target.value)} required>
                <option value="">— select —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Nights">
              <input className={inputClass} type="number" value={nights} onChange={(e) => setNights(Number(e.target.value))} min={1} />
            </Field>
            <Field label="Check-in">
              <input className={inputClass} type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
            </Field>
            <Field label="Check-out">
              <input className={inputClass} type="date" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
            </Field>
            <Field label="Total amount (₹)">
              <input className={inputClass} type="number" value={totalAmount} onChange={(e) => setTotalAmount(Number(e.target.value))} min={0} />
            </Field>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit">Create reservation</Button>
        </form>
      </CardBody>
    </Card>
  );
}
