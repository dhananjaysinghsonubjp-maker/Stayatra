import { useEffect, useState } from 'react';
import { query, ApiError } from '../api';
import { useAuth } from '../AuthContext';
import { Button, EmptyState, PageHeader } from '../components/ui';
import { CheckInModal } from './checkin/CheckInModal';
import { computeInvoiceTotals } from '../invoice';
import type { Room } from '../types';

type BoardStatus = 'available' | 'departing_today' | 'occupied' | 'housekeeping';

const STATUS_CARD_STYLE: Record<BoardStatus, string> = {
  available: 'border-emerald-200 bg-emerald-50/60',
  occupied: 'border-slate-200 bg-white',
  departing_today: 'border-amber-300 bg-amber-50/70',
  housekeeping: 'border-blue-200 bg-blue-50/60',
};
const STATUS_BADGE_STYLE: Record<BoardStatus, string> = {
  available: 'bg-emerald-100 text-emerald-700',
  occupied: 'bg-slate-100 text-slate-600',
  departing_today: 'bg-amber-100 text-amber-700',
  housekeeping: 'bg-blue-100 text-blue-700',
};
const STATUS_LABEL: Record<BoardStatus, string> = {
  available: 'Open',
  occupied: 'Occupied',
  departing_today: 'Departing Today',
  housekeeping: 'Housekeeping',
};

/** Same calendar day, compared in the browser's local time — a cosmetic badge, not a financial figure. */
function isToday(isoDate: string): boolean {
  return isoDate.slice(0, 10) === new Date().toLocaleDateString('en-CA');
}

function boardStatus(room: Room): BoardStatus {
  if (room.status === 'housekeeping') return 'housekeeping';
  if (room.status === 'available') return 'available';
  if (room.currentStay && isToday(room.currentStay.checkOut)) return 'departing_today';
  return 'occupied';
}

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

function StatChip({ value, label, tone }: { value: string | number; label: string; tone: string }) {
  return (
    <div className={`flex flex-col items-center justify-center rounded-xl px-4 py-2.5 ${tone}`}>
      <span className="text-lg font-bold leading-tight tabular-nums">{value}</span>
      <span className="text-[10px] font-semibold uppercase tracking-wide opacity-80">{label}</span>
    </div>
  );
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

  const statuses = rooms.map(boardStatus);
  const counts = {
    total: rooms.length,
    available: statuses.filter((s) => s === 'available').length,
    occupied: statuses.filter((s) => s === 'occupied' || s === 'departing_today').length,
    departingToday: statuses.filter((s) => s === 'departing_today').length,
    housekeeping: statuses.filter((s) => s === 'housekeeping').length,
  };
  const occupancy = counts.total > 0 ? ((counts.occupied / counts.total) * 100).toFixed(2) : '0.00';

  return (
    <div>
      <PageHeader title="Room Board" />

      {rooms.length > 0 && (
        <div className="mb-5 flex flex-wrap gap-2.5">
          <StatChip value={counts.total} label="Rooms" tone="bg-slate-100 text-slate-700" />
          <StatChip value={counts.available} label="Open" tone="bg-emerald-50 text-emerald-700" />
          <StatChip value={counts.occupied} label="Occupied" tone="bg-slate-100 text-slate-700" />
          <StatChip value={counts.departingToday} label="Departing Today" tone="bg-amber-50 text-amber-700" />
          <StatChip value={counts.housekeeping} label="Housekeeping" tone="bg-blue-50 text-blue-700" />
          <StatChip value={`${occupancy}%`} label="Occupancy" tone="bg-emerald-50 text-emerald-700" />
        </div>
      )}

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {rooms.length === 0 ? (
        <EmptyState title="No rooms yet" hint="Add rooms from Staff & Setup" />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {rooms.map((r) => {
            const status = boardStatus(r);
            const due = dueForRoom(r);
            const delayed = r.delayed ?? false;
            return (
              <div
                key={r.id}
                className={`relative flex min-h-[220px] flex-col items-center gap-1.5 rounded-xl border p-4 text-center ${STATUS_CARD_STYLE[status]} ${
                  delayed ? 'border-l-4 border-l-red-500' : ''
                }`}
              >
                {due > 0 && (
                  <div
                    className="absolute -top-2.5 right-4 rounded-t-sm bg-red-600 px-2 py-1 text-[10px] font-bold leading-none text-white shadow-sm"
                    style={{ clipPath: 'polygon(0 0, 100% 0, 100% 75%, 50% 100%, 0 75%)' }}
                    title={`Due ₹${due.toFixed(2)}`}
                  >
                    Due ₹{due % 1 === 0 ? due : due.toFixed(2)}
                  </div>
                )}

                <div className="flex w-full items-center justify-between">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STATUS_BADGE_STYLE[status]}`}>
                    {STATUS_LABEL[status]}
                  </span>
                  {delayed && (
                    <span title="Past its cleaning deadline — flagged for Theft Protection review" className="text-red-500">
                      ⚠
                    </span>
                  )}
                </div>

                <span className="mt-2 text-2xl font-bold text-slate-900">{r.roomNumber}</span>
                <span className="text-xs text-slate-500">{r.roomCategory?.name ?? 'Uncategorized'}</span>

                {r.currentStay ? (
                  <>
                    <span className="truncate text-sm font-semibold text-slate-800">{r.currentStay.guestName}</span>
                    <span className="text-[11px] text-slate-400">
                      {r.currentStay.checkIn.slice(0, 10)} → {r.currentStay.checkOut.slice(0, 10)}
                    </span>
                  </>
                ) : (
                  <span className="text-sm text-slate-400">Vacant</span>
                )}

                <div className="mt-auto w-full pt-2">
                  {status === 'available' && canCheckIn && (
                    <Button variant="secondary" className="w-full text-xs" onClick={() => setCheckInRoom(r)}>
                      Check in
                    </Button>
                  )}
                </div>
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
