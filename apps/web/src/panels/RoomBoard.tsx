import { useEffect, useState } from 'react';
import { query, ApiError } from '../api';
import { useAuth } from '../AuthContext';
import { Badge, Button, EmptyState, PageHeader } from '../components/ui';
import { CheckInModal } from './checkin/CheckInModal';
import { computeInvoiceTotals } from '../invoice';
import type { Room } from '../types';

const STATUS_STYLE: Record<Room['status'], string> = {
  available: 'border-emerald-200 bg-emerald-50',
  occupied: 'border-amber-200 bg-amber-50',
  housekeeping: 'border-blue-200 bg-blue-50',
};

function dueForRoom(room: Room): number {
  const stay = room.currentStay;
  if (!stay || stay.totalAmount == null) return 0; // null totalAmount = redacted for housekeeping, not "no due"
  const totals = computeInvoiceTotals({
    totalAmount: Number(stay.totalAmount),
    lineItems: stay.lineItems ?? [],
    discountAmount: stay.discountAmount ? Number(stay.discountAmount) : null,
    gstExempt: stay.gstExempt,
  });
  return Math.max(0, totals.grandTotal - Number(stay.paidAmount ?? 0));
}

export function RoomBoard({ hotelId }: { hotelId: string }) {
  const { token, role } = useAuth();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [checkInRoom, setCheckInRoom] = useState<Room | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canCheckIn = ['owner', 'manager', 'front_desk'].includes(role('pms') ?? '');

  async function refresh() {
    try {
      setRooms(await query<Room[]>('bookings.getRoomBoard', { hotelId }, token ?? undefined));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load room board');
    }
  }
  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId]);

  const counts = {
    available: rooms.filter((r) => r.status === 'available').length,
    occupied: rooms.filter((r) => r.status === 'occupied').length,
    housekeeping: rooms.filter((r) => r.status === 'housekeeping').length,
  };

  return (
    <div>
      <PageHeader
        title="Room Board"
        subtitle={`${counts.available} available · ${counts.occupied} occupied · ${counts.housekeeping} in housekeeping`}
      />
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {rooms.length === 0 ? (
        <EmptyState title="No rooms yet" hint="Add rooms from Staff & Setup" />
      ) : (
        <div className="grid grid-cols-2 gap-3 pt-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {rooms.map((r) => {
            const due = dueForRoom(r);
            return (
              <div key={r.id} className={`relative flex flex-col gap-2 rounded-xl border p-4 ${STATUS_STYLE[r.status]}`}>
                {due > 0 && (
                  <div
                    className="absolute -top-2.5 right-4 rounded-t-sm bg-red-600 px-2 py-1 text-[10px] font-bold leading-none text-white shadow-sm"
                    style={{ clipPath: 'polygon(0 0, 100% 0, 100% 75%, 50% 100%, 0 75%)' }}
                    title={`Due ₹${due.toFixed(2)}`}
                  >
                    Due ₹{due % 1 === 0 ? due : due.toFixed(2)}
                  </div>
                )}
                <div className="flex items-start justify-between">
                  <span className="text-base font-semibold text-slate-900">{r.roomNumber}</span>
                  <Badge tone={r.status}>{r.status}</Badge>
                </div>
                <span className="text-xs text-slate-500">{r.roomCategory?.name ?? 'uncategorized'}</span>
                {r.currentStay && <span className="truncate text-sm font-medium text-slate-700">{r.currentStay.guestName}</span>}
                {r.status === 'available' && canCheckIn && (
                  <Button variant="secondary" className="mt-1 w-full text-xs" onClick={() => setCheckInRoom(r)}>
                    Check in
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {checkInRoom && (
        <CheckInModal room={checkInRoom} hotelId={hotelId} onClose={() => setCheckInRoom(null)} onDone={refresh} />
      )}
    </div>
  );
}
