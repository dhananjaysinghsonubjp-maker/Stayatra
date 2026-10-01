import { useEffect, useState } from 'react';
import { mutate, query, ApiError } from '../api';
import { useAuth } from '../AuthContext';
import { Badge, Button, Card, Field, inputClass } from '../components/ui';
import { computeInvoiceTotals } from '../invoice';
import { paymentMethodLabel } from '../paymentMethods';
import { AddPaymentModal } from './AddPaymentModal';
import type { Booking, BookingGuest, IdType, Room } from '../types';

const EDIT_WINDOW_MS = 60 * 60 * 1000;

const ID_TYPES: { value: IdType; label: string }[] = [
  { value: 'aadhaar', label: 'Aadhaar' },
  { value: 'passport', label: 'Passport' },
  { value: 'driving_license', label: 'Driving License' },
  { value: 'voter_id', label: 'Voter ID' },
  { value: 'other', label: 'Other' },
];

function minutesLeft(checkedInAt: string | null): number {
  if (!checkedInAt) return 0;
  const elapsed = Date.now() - new Date(checkedInAt).getTime();
  return Math.max(0, Math.ceil((EDIT_WINDOW_MS - elapsed) / 60000));
}

export function EditBookingModal({ hotelId, bookingId, onClose, onDone }: { hotelId: string; bookingId: string; onClose: () => void; onDone: () => void }) {
  const { token } = useAuth();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [guests, setGuests] = useState<BookingGuest[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [payingBooking, setPayingBooking] = useState(false);

  // editable fields — populated once the booking loads
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [idType, setIdType] = useState<IdType>('aadhaar');
  const [idNumber, setIdNumber] = useState('');
  const [purposeOfStay, setPurposeOfStay] = useState('');
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [totalAmount, setTotalAmount] = useState(0);
  const [roomId, setRoomId] = useState('');
  const [discountAmount, setDiscountAmount] = useState<number | ''>('');
  const [gstExempt, setGstExempt] = useState(false);

  // add-guest mini form
  const [addingGuest, setAddingGuest] = useState(false);
  const [newGuestName, setNewGuestName] = useState('');
  const [newGuestPhone, setNewGuestPhone] = useState('');

  async function refresh() {
    try {
      const [b, g] = await Promise.all([
        query<Booking>('bookings.getBooking', { bookingId }, token ?? undefined),
        query<BookingGuest[]>('bookings.listBookingGuests', { bookingId }, token ?? undefined),
      ]);
      setBooking(b);
      setGuests(g);
      setGuestName(b.guestName);
      setGuestPhone(b.guestPhone ?? '');
      setIdType(b.idType ?? 'aadhaar');
      setIdNumber(b.idNumber ?? '');
      setPurposeOfStay(b.purposeOfStay ?? '');
      setCheckIn(b.checkIn.slice(0, 10));
      setCheckOut(b.checkOut.slice(0, 10));
      setTotalAmount(Number(b.totalAmount));
      setRoomId(b.assignedRoomId ?? '');
      setDiscountAmount(b.discountAmount ? Number(b.discountAmount) : '');
      setGstExempt(b.gstExempt);

      const allRooms = await query<Room[]>('hotels.listRooms', { hotelId }, token ?? undefined);
      setRooms(allRooms.filter((r) => r.roomCategoryId === b.roomCategoryId && (r.status === 'available' || r.id === b.assignedRoomId)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load booking');
    }
  }
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId]);

  const canEdit = booking?.status === 'checked_in' && minutesLeft(booking.checkedInAt) > 0;
  const remaining = booking ? minutesLeft(booking.checkedInAt) : 0;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const nights = Math.max(1, Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86400000));
      await mutate(
        'bookings.updateBooking',
        {
          bookingId,
          guestName,
          guestPhone: guestPhone || undefined,
          idType,
          idNumber,
          purposeOfStay: purposeOfStay || undefined,
          roomId: roomId || undefined,
          checkIn,
          checkOut,
          nights,
          totalAmount,
          discountAmount: discountAmount === '' ? null : discountAmount,
          gstExempt,
        },
        token ?? undefined,
      );
      onDone();
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  }

  async function removePayment(paymentId: string) {
    if (!confirm('Remove this payment record?')) return;
    setError(null);
    try {
      await mutate('bookings.deletePayment', { paymentId }, token ?? undefined);
      onDone();
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to remove payment');
    }
  }

  async function addGuest(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await mutate('bookings.addBookingGuest', { bookingId, name: newGuestName, phone: newGuestPhone || undefined }, token ?? undefined);
      setNewGuestName('');
      setNewGuestPhone('');
      setAddingGuest(false);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add guest');
    }
  }

  async function removeGuest(id: string) {
    if (!confirm('Remove this guest from the booking?')) return;
    try {
      await mutate('bookings.removeBookingGuest', { id }, token ?? undefined);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to remove guest');
    }
  }

  if (!booking) {
    return (
      <div className="fixed inset-0 z-10 flex items-center justify-center bg-slate-900/40 px-4">
        <Card className="w-full max-w-md p-6 text-sm text-slate-500">{error ?? 'Loading…'}</Card>
      </div>
    );
  }

  const totals = computeInvoiceTotals({
    totalAmount,
    lineItems: booking.lineItems ?? [],
    discountAmount: discountAmount === '' ? null : discountAmount,
    gstExempt,
  });
  const due = totals.grandTotal - Number(booking.paidAmount ?? 0);

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center overflow-y-auto bg-slate-900/40 px-4 py-8">
      <Card className="w-full max-w-3xl p-5">
        <div className="mb-4 flex items-center justify-between">
          <h4 className="text-sm font-semibold text-slate-900">Manage stay — {booking.guestName}</h4>
          {canEdit ? (
            <Badge tone="available">Editable for {remaining}m more</Badge>
          ) : (
            <Badge tone="slate">Edit window closed</Badge>
          )}
        </div>

        <div className="max-h-[70vh] space-y-5 overflow-y-auto pr-1">
          <form onSubmit={save} className="space-y-4">
            <fieldset disabled={!canEdit} className="space-y-4 disabled:opacity-60">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div className="col-span-2 sm:col-span-1">
                  <Field label="Full name">
                    <input className={inputClass} value={guestName} onChange={(e) => setGuestName(e.target.value)} required />
                  </Field>
                </div>
                <Field label="Mobile number">
                  <input className={inputClass} value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} placeholder="10-digit number" />
                </Field>
                <Field label="Purpose of stay">
                  <input className={inputClass} value={purposeOfStay} onChange={(e) => setPurposeOfStay(e.target.value)} />
                </Field>
                <Field label="ID type">
                  <select className={inputClass} value={idType} onChange={(e) => setIdType(e.target.value as IdType)}>
                    {ID_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="ID number">
                  <input className={inputClass} value={idNumber} onChange={(e) => setIdNumber(e.target.value)} required />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Field label="Check-in date">
                  <input className={inputClass} type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} required />
                </Field>
                <Field label="Check-out date">
                  <input className={inputClass} type="date" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} required />
                </Field>
                <Field label="Total amount (₹)">
                  <input className={inputClass} type="number" value={totalAmount} onChange={(e) => setTotalAmount(Number(e.target.value))} min={0} />
                </Field>
                <Field label="Room">
                  <select className={inputClass} value={roomId} onChange={(e) => setRoomId(e.target.value)}>
                    {rooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.roomNumber}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Field label="Discount (₹)">
                  <input
                    className={inputClass}
                    type="number"
                    value={discountAmount}
                    onChange={(e) => setDiscountAmount(e.target.value === '' ? '' : Number(e.target.value))}
                    min={0}
                    placeholder="0"
                  />
                </Field>
                <div className="flex items-end pb-2">
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={gstExempt} onChange={(e) => setGstExempt(e.target.checked)} />
                    GST exempt
                  </label>
                </div>
                <div className="flex flex-col justify-end rounded-lg bg-slate-50 px-3 py-2 text-sm">
                  <span className="text-xs text-slate-500">Total (incl. GST)</span>
                  <span className="font-semibold text-slate-900">₹{totals.grandTotal.toFixed(2)}</span>
                </div>
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}
              {canEdit && (
                <div className="flex justify-end">
                  <Button type="submit" disabled={saving}>
                    {saving ? 'Saving…' : 'Save changes'}
                  </Button>
                </div>
              )}
            </fieldset>
          </form>

          {/* Payments */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h5 className="text-sm font-semibold text-slate-900">Payments</h5>
              <Button type="button" variant="secondary" className="text-xs" onClick={() => setPayingBooking(true)}>
                + Add payment
              </Button>
            </div>
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {(booking.payments ?? []).length === 0 ? (
                <p className="px-3 py-3 text-xs text-slate-400">No payments recorded yet.</p>
              ) : (
                (booking.payments ?? []).map((p) => (
                  <div key={p.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <div>
                      <span className="font-medium text-slate-900">₹{Number(p.amount).toFixed(2)}</span>{' '}
                      <span className="text-xs text-slate-400">
                        {paymentMethodLabel(p.method)} · {p.collectedAt.slice(0, 16).replace('T', ' ')}
                      </span>
                    </div>
                    {canEdit && (
                      <button type="button" onClick={() => removePayment(p.id)} className="text-xs text-red-500 hover:underline">
                        Remove
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
            <p className={`mt-1.5 text-xs font-medium ${due > 0.01 ? 'text-amber-600' : 'text-emerald-600'}`}>
              {due > 0.01 ? `₹${due.toFixed(2)} due` : 'Paid in full'}
            </p>
          </div>

          {/* Additional guests */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h5 className="text-sm font-semibold text-slate-900">Additional guests</h5>
              {booking.status === 'checked_in' && !addingGuest && (
                <Button type="button" variant="secondary" className="text-xs" onClick={() => setAddingGuest(true)}>
                  + Add guest
                </Button>
              )}
            </div>
            {addingGuest && (
              <form onSubmit={addGuest} className="mb-3 grid grid-cols-3 gap-2">
                <input className={inputClass} placeholder="Full name" value={newGuestName} onChange={(e) => setNewGuestName(e.target.value)} required />
                <input className={inputClass} placeholder="Mobile (optional)" value={newGuestPhone} onChange={(e) => setNewGuestPhone(e.target.value)} />
                <div className="flex gap-2">
                  <Button type="submit" variant="secondary" className="flex-1 text-xs">
                    Add
                  </Button>
                  <Button type="button" variant="ghost" className="text-xs" onClick={() => setAddingGuest(false)}>
                    ✕
                  </Button>
                </div>
              </form>
            )}
            {guests.length === 0 ? (
              <p className="text-xs text-slate-400">No additional guests on this stay.</p>
            ) : (
              <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {guests.map((g) => (
                  <div key={g.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span className="text-slate-800">
                      {g.name} {g.phone && <span className="text-xs text-slate-400">· {g.phone}</span>}
                    </span>
                    <button type="button" onClick={() => removeGuest(g.id)} className="text-xs text-red-500 hover:underline">
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </Card>

      {payingBooking && (
        <AddPaymentModal
          booking={booking}
          onClose={() => setPayingBooking(false)}
          onDone={() => {
            onDone();
            void refresh();
          }}
        />
      )}
    </div>
  );
}
