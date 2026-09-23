import { useEffect, useState } from 'react';
import { mutate, query, ApiError } from '../api';
import { useAuth } from '../AuthContext';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, PageHeader, inputClass } from '../components/ui';
import { CheckInModal } from './checkin/CheckInModal';
import { computeInvoiceTotals } from '../invoice';
import { PAYMENT_METHODS } from '../paymentMethods';
import type { Booking, PaymentMethod, RoomCategory } from '../types';

function todayPlus(days: number) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

export function Bookings({ hotelId }: { hotelId: string }) {
  const { token } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [categories, setCategories] = useState<RoomCategory[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [payingBooking, setPayingBooking] = useState<Booking | null>(null);
  const [checkingInBooking, setCheckingInBooking] = useState<Booking | null>(null);
  const [showForm, setShowForm] = useState(false);

  async function refresh() {
    try {
      const [b, c] = await Promise.all([
        query<Booking[]>('bookings.listReservations', { hotelId }, token ?? undefined),
        query<RoomCategory[]>('hotels.listRoomCategories', { hotelId }, token ?? undefined),
      ]);
      setBookings(b);
      setCategories(c);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load reservations');
    }
  }
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId]);

  return (
    <div>
      <PageHeader
        title="Reservations"
        subtitle={`${bookings.length} total`}
        action={
          <Button onClick={() => setShowForm((v) => !v)} variant={showForm ? 'secondary' : 'primary'}>
            {showForm ? 'Cancel' : '+ New reservation'}
          </Button>
        }
      />

      {showForm && (
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

      <Card>
        {bookings.length === 0 ? (
          <CardBody>
            <EmptyState title="No reservations yet" />
          </CardBody>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-medium text-slate-500">
                  <th className="px-5 py-3">Guest</th>
                  <th className="px-5 py-3">Dates</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Source</th>
                  <th className="px-5 py-3">Paid / Total</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {bookings.map((b) => {
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
                      <td className="px-5 py-3 text-slate-500">{b.source}</td>
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
                          {b.status === 'confirmed' && (
                            <button onClick={() => setCheckingInBooking(b)} className="text-xs font-medium text-brand-600 hover:underline">
                              Check in
                            </button>
                          )}
                          {outstanding > 0 && (
                            <button onClick={() => setPayingBooking(b)} className="text-xs font-medium text-brand-600 hover:underline">
                              Add payment
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

      {payingBooking && (
        <AddPaymentModal booking={payingBooking} onClose={() => setPayingBooking(null)} onDone={refresh} />
      )}
      {checkingInBooking && (
        <CheckInModal hotelId={hotelId} reservation={checkingInBooking} onClose={() => setCheckingInBooking(null)} onDone={refresh} />
      )}
    </div>
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

function AddPaymentModal({ booking, onClose, onDone }: { booking: Booking; onClose: () => void; onDone: () => void }) {
  const { token } = useAuth();
  const totals = computeInvoiceTotals({
    totalAmount: Number(booking.totalAmount),
    lineItems: booking.lineItems ?? [],
    discountAmount: booking.discountAmount ? Number(booking.discountAmount) : null,
    gstExempt: booking.gstExempt,
  });
  const outstanding = totals.grandTotal - Number(booking.paidAmount ?? 0);
  const [amount, setAmount] = useState(outstanding);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await mutate('bookings.addPayment', { bookingId: booking.id, amount, method, referenceNumber: referenceNumber || undefined }, token ?? undefined);
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Payment failed');
    }
  }

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-slate-900/40 px-4" onClick={onClose}>
      <Card className="w-full max-w-md p-5" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
        <h4 className="mb-1 text-sm font-semibold text-slate-900">Add payment — {booking.guestName}</h4>
        <p className="mb-4 text-xs text-slate-500">Outstanding: ₹{outstanding.toFixed(2)}</p>
        <form onSubmit={submit} className="space-y-3.5">
          <Field label="Amount (₹)">
            <input className={inputClass} type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} min={1} max={outstanding} />
          </Field>
          <Field label="Reference number">
            <input className={inputClass} value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} placeholder="Optional" />
          </Field>
          <div>
            <p className="mb-1.5 text-xs font-medium text-slate-600">Method</p>
            <div className="flex flex-wrap gap-2">
              {PAYMENT_METHODS.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setMethod(m.value)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium ring-1 ring-inset transition-colors ${
                    method === m.value ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-600 ring-slate-300 hover:bg-slate-50'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Record payment</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
