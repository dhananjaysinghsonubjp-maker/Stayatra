import { useEffect, useState } from 'react';
import { query } from '../api';
import { useAuth } from '../AuthContext';
import { Button } from '../components/ui';
import { PaymentHistory, type PaymentHistoryEntry } from './PaymentHistory';
import type { Booking, Hotel, Room } from '../types';

const ORDINALS = ['Ground', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth', 'Eleventh', 'Twelfth'];

/** A room number's leading digit(s) as its floor — "101"/"103" → 1, "401" → 4 — the same
 * convention the reference notice groups by. There's no real Room.floor field in this schema, so
 * this is inferred rather than stored. */
function floorLabel(roomNumber: string): string {
  const digits = roomNumber.replace(/\D/g, '');
  if (digits.length < 3) return 'Ground Floor';
  const floorNum = parseInt(digits.slice(0, digits.length - 2), 10) || 0;
  return `${ORDINALS[floorNum] ?? `${floorNum}th`} Floor`;
}

/**
 * §user request, with a reference hotel's own "Guest Room Allocation Notice" as the exact
 * target — a printable document for a reservation's own Master Folio: who booked it, which guest
 * is actually in which room (a multi-room reservation can have a different name per room — see
 * Modify Stay's own guestName field), grouped by floor, and the payment report right underneath
 * it in the same document (scroll, not a separate screen).
 */
export function RoomAllocationPrintView({
  hotelId,
  bookings,
  rooms,
  paymentTimeline,
  grandTotal,
  paid,
  due,
  onClose,
}: {
  hotelId: string;
  bookings: Booking[];
  rooms: Room[];
  paymentTimeline: PaymentHistoryEntry[];
  grandTotal: number;
  paid: number;
  due: number;
  onClose: () => void;
}) {
  const { token } = useAuth();
  const [hotel, setHotel] = useState<Hotel | null>(null);

  useEffect(() => {
    query<Hotel>('hotels.get', { hotelId }, token ?? undefined).then(setHotel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId]);

  const first = bookings[0];
  const bookerName = first.bookedByName ?? first.guestName;
  const bookerPhone = first.bookedByPhone ?? first.guestPhone;

  const byFloor = new Map<string, { roomNumber: string; guestName: string; phone: string | null }[]>();
  for (const b of bookings) {
    const roomNumber = rooms.find((r) => r.id === b.assignedRoomId)?.roomNumber ?? '—';
    const floor = floorLabel(roomNumber);
    const list = byFloor.get(floor) ?? [];
    // §user request — "room no, Guest Name & Phone No": a room's own guest can have their own
    // phone on the booking row too, falling back to the group's shared number when that room never
    // got one of its own set.
    list.push({ roomNumber, guestName: b.guestName, phone: b.guestPhone ?? bookerPhone });
    byFloor.set(floor, list);
  }
  const floors = [...byFloor.entries()].sort(([, a], [, b]) => Number(a[0]?.roomNumber) - Number(b[0]?.roomNumber));

  return (
    <div className="room-allocation-print-root fixed inset-0 z-[60] overflow-y-auto bg-slate-900/40 print:overflow-visible print:bg-white">
      <div className="mx-auto my-8 max-w-5xl rounded-xl bg-white p-8 shadow-xl print:my-0 print:max-w-none print:rounded-none print:p-0 print:shadow-none">
        {!hotel ? (
          <p className="py-20 text-center text-sm text-slate-400">Loading…</p>
        ) : (
          <>
            <div className="text-center">
              <p className="text-2xl font-bold uppercase tracking-wide text-slate-900">{hotel.name}</p>
              <p className="mt-1 text-base font-bold uppercase tracking-wide text-slate-700">Guest Room Allocation Notice</p>
              <p className="mt-2 text-sm text-slate-500">
                <span className="font-semibold text-slate-700">Date:</span> {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
              </p>
            </div>

            <div className="mt-5 flex justify-between border-y border-slate-200 py-3 text-sm">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Primary Booker</p>
                <p className="font-bold text-slate-900">{bookerName}</p>
                {bookerPhone && <p className="text-xs text-slate-500">{bookerPhone}</p>}
              </div>
              <div className="text-right">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Rooms</p>
                <p className="font-bold text-slate-900">{bookings.length}</p>
              </div>
            </div>

            {/* §user request — "Room allocation left side and payment hisab right side, properly
                alag alag box": two clearly separate boxes side by side instead of one long stacked
                page, so the room list and the money owed don't read as one undifferentiated block. */}
            <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2 print:grid-cols-2">
              <div className="rounded-xl border border-slate-200 p-4">
                <p className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">Room Allocation</p>
                {floors.map(([floor, roomRows]) => (
                  <div key={floor} className="mb-5 last:mb-0">
                    <p className="mb-2 text-sm font-bold uppercase tracking-wide text-brand-700">{floor}</p>
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr className="bg-brand-700 text-left text-white">
                          <th className="border border-brand-800 px-3 py-2">Room No.</th>
                          <th className="border border-brand-800 px-3 py-2">Guest Name</th>
                          <th className="border border-brand-800 px-3 py-2">Phone No.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {roomRows
                          .sort((a, b) => Number(a.roomNumber) - Number(b.roomNumber))
                          .map((r) => (
                            <tr key={r.roomNumber} className="even:bg-slate-50">
                              <td className="border border-slate-200 px-3 py-2 text-center">{r.roomNumber}</td>
                              <td className="border border-slate-200 px-3 py-2">{r.guestName}</td>
                              <td className="border border-slate-200 px-3 py-2">{r.phone ?? '—'}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>

              <div className="rounded-xl border border-slate-200 p-4">
                <p className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">Payment Summary</p>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between text-slate-600">
                    <span>Total Charges</span>
                    <span className="font-medium text-slate-900">₹{grandTotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Paid</span>
                    <span className="font-medium text-slate-900">₹{paid.toFixed(2)}</span>
                  </div>
                  <div className={`flex justify-between font-semibold ${due > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                    <span>Due</span>
                    <span>{due > 0 ? `₹${due.toFixed(2)}` : 'Paid in full'}</span>
                  </div>
                </div>

                <p className="mb-2 mt-5 text-xs font-bold uppercase tracking-wide text-slate-500">Payment History</p>
                <PaymentHistory entries={paymentTimeline} />
              </div>
            </div>

            <div className="mt-8 text-sm text-slate-700">
              <p className="font-semibold">Reception Desk</p>
              <p>{hotel.name}</p>
            </div>
          </>
        )}
      </div>

      <div className="no-print fixed bottom-6 right-6 flex gap-2">
        <Button type="button" onClick={() => window.print()} disabled={!hotel}>
          Print / Save as PDF
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}
