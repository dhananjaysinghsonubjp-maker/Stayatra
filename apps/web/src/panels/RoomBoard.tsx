import { useEffect, useState } from 'react';
import { query, mutate, ApiError } from '../api';
import { useAuth } from '../AuthContext';
import { Button, Card, EmptyState, PageHeader } from '../components/ui';
import { CheckInModal } from './checkin/CheckInModal';
import { ChannelIcon } from './channel-manager/ChannelBadge';
import { SOURCE_LABEL } from './channel-manager/ota-labels';
import { computeInvoiceTotals } from '../invoice';
import { formatDateShort } from '../dateFormat';
import type { Room } from '../types';

type BoardStatus = 'available' | 'departing_today' | 'occupied' | 'housekeeping';

/** §user request — Available green, Occupied blue (reverting the earlier all-blue pass for these
 * two specific states). Departing Today/Housekeeping weren't named, so they stay distinguishable
 * shades near "occupied blue" and a separate accent respectively. "Due"/delayed red stays the one
 * exception — a real money/overdue alert should still stand out, not blend into the status colour. */
const STATUS_BADGE_STYLE: Record<BoardStatus, string> = {
  available: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300',
  occupied: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300',
  departing_today: 'bg-[#002491]/90 text-white',
  housekeeping: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300',
};
/** §user request — the brand-colour left strip on every row sat flush under the equally
 * brand-coloured header with no gap, so it read as one glued-on bar running down the table
 * rather than a per-row accent. Dropped back to no strip at all — delayed still overrides with
 * red, a real overdue alert still needs to stand out. */
const STATUS_STRIP_STYLE = 'border-l-transparent';
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

type BoardFilter = 'all' | BoardStatus;
const FILTER_LABEL: Record<BoardFilter, string> = {
  all: 'All',
  available: 'Available',
  occupied: 'Occupied',
  departing_today: 'Checkout Due',
  housekeeping: 'Housekeeping',
};
const FILTER_DOT_TONE: Record<BoardFilter, string> = {
  all: 'bg-slate-400',
  available: 'bg-emerald-500',
  occupied: 'bg-blue-500',
  departing_today: 'bg-[#002491]',
  housekeeping: 'bg-amber-500',
};

/** §user request — reference: DigiStay's "Room view" toolbar (filter pills + search, one clean
 * row, generous padding). Pills actually filter the table below (not cosmetic), same for search. */
/** §user request — "ye sab details 2 baar dekh raha hu, ek clean table banao jisme ye sab show
 * ho aur duplicate na ho": these filter pills already carry every count (Total Rooms = "All",
 * Rooms Open = "Available", Housekeeping, etc.) that used to also live in a separate stat-card
 * row above — that row is gone now, this is the one place those numbers live. Occupancy is the
 * only figure with no natural pill of its own, so it rides along as a plain, non-clickable chip. */
function RoomBoardToolbar({
  filter,
  onFilter,
  counts,
  occupancy,
  search,
  onSearch,
}: {
  filter: BoardFilter;
  onFilter: (f: BoardFilter) => void;
  counts: Record<BoardFilter, number>;
  occupancy: string;
  search: string;
  onSearch: (v: string) => void;
}) {
  const filters: BoardFilter[] = ['all', 'available', 'occupied', 'departing_today', 'housekeeping'];
  return (
    <Card className="mb-5 px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {filters.map((f) => {
            const active = filter === f;
            return (
              <button
                key={f}
                type="button"
                onClick={() => onFilter(f)}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors ${
                  active
                    ? 'border-brand-600 bg-brand-50 text-brand-700 dark:border-brand-500 dark:bg-brand-500/10 dark:text-brand-300'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                }`}
              >
                {f !== 'all' && <span className={`h-2 w-2 rounded-full ${FILTER_DOT_TONE[f]}`} />}
                {FILTER_LABEL[f]}
                <span className={`ml-0.5 tabular-nums ${active ? 'text-brand-600 dark:text-brand-300' : 'text-slate-400 dark:text-slate-500'}`}>
                  {counts[f]}
                </span>
              </button>
            );
          })}
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2 text-sm font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
            Occupancy
            <span className="font-bold tabular-nums text-brand-600 dark:text-brand-400">{occupancy}%</span>
          </span>
        </div>
        <div className="relative w-full sm:w-64">
          <svg
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search by Room/Guest"
            className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500"
          />
        </div>
      </div>
    </Card>
  );
}

export function RoomBoard({ hotelId }: { hotelId: string }) {
  const { token, role } = useAuth();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [checkInRoom, setCheckInRoom] = useState<Room | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<BoardFilter>('all');
  const [search, setSearch] = useState('');
  const [checkingOutId, setCheckingOutId] = useState<string | null>(null);
  const canCheckIn = ['owner', 'manager', 'front_desk'].includes(role('pms') ?? '');

  async function refresh() {
    try {
      setRooms(await query<Room[]>('bookings.getRoomBoard', { hotelId }, token ?? undefined));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load Room View');
    }
  }

  async function checkOutGuest(r: Room) {
    if (!r.currentStay) return;
    if (!confirm(`Check out ${r.currentStay.guestName} from Room ${r.roomNumber}? The room will move to Housekeeping until it's cleaned.`)) return;
    setCheckingOutId(r.currentStay.id);
    try {
      await mutate('bookings.checkOutGuest', { hotelId, bookingId: r.currentStay.id }, token ?? undefined);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Check-out failed');
    } finally {
      setCheckingOutId(null);
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

  const filterCounts: Record<BoardFilter, number> = {
    all: rooms.length,
    available: statuses.filter((s) => s === 'available').length,
    occupied: statuses.filter((s) => s === 'occupied').length,
    departing_today: statuses.filter((s) => s === 'departing_today').length,
    housekeeping: statuses.filter((s) => s === 'housekeeping').length,
  };
  const q = search.trim().toLowerCase();
  const filteredRooms = rooms.filter((r, i) => {
    if (filter !== 'all' && statuses[i] !== filter) return false;
    if (q && !r.roomNumber.toLowerCase().includes(q) && !(r.currentStay?.guestName ?? '').toLowerCase().includes(q)) return false;
    return true;
  });

  return (
    <div>
      <PageHeader title="Room View" />

      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {rooms.length > 0 && (
        <RoomBoardToolbar filter={filter} onFilter={setFilter} counts={filterCounts} occupancy={occupancy} search={search} onSearch={setSearch} />
      )}

      {rooms.length === 0 ? (
        <EmptyState title="No rooms yet" hint="Add rooms from Settings → Room Setup" />
      ) : filteredRooms.length === 0 ? (
        <EmptyState title="No rooms match" hint="Try a different filter or search term" />
      ) : (
        <Card className="overflow-hidden">
          {/* `overflow-x-auto` + `whitespace-nowrap` on every cell (not just a width cap) —
              without the nowrap, a narrow viewport shrinks columns instead of scrolling, which
              wrapped header labels, the Payment badge, and the "Check in" button text onto two
              lines and made the row look broken. Room+Category merged into one cell (room number
              with its type as a small subtext) to cut a column and reduce how crowded the row
              feels overall. */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
              <thead>
                <tr className="bg-brand-600 text-left text-xs font-semibold text-white">
                  <th className="px-5 py-3">Room</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Guest</th>
                  <th className="px-5 py-3">Check In</th>
                  <th className="px-5 py-3">Check Out</th>
                  <th className="px-5 py-3">Payment</th>
                  <th className="px-5 py-3">Channel</th>
                  <th className="px-5 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {/* Column order follows how front desk actually scans the board: Room, with its
                    category folded in as a small subtext underneath (which one, and what type) →
                    Status (free or not — the decision-driving signal) → Guest (who, read as its
                    own clean unit — a channel icon crammed next to the name looked cluttered, so
                    it moved to its own column) → the stay dates (read as one range) → Payment (a
                    money flag, placed just before the tail columns since it's often what decides
                    the next click) → Channel (how the booking arrived — secondary context, not
                    needed to read every row) → Action (end of row, same place every other table in
                    the app puts it). */}
                {filteredRooms.map((r, i) => {
                  const status = boardStatus(r);
                  const due = dueForRoom(r);
                  const delayed = r.delayed ?? false;
                  const rowBg = i % 2 === 0 ? 'bg-white dark:bg-slate-800' : 'bg-slate-50 dark:bg-slate-800/60';
                  const stripStyle = delayed ? 'border-l-red-500' : STATUS_STRIP_STYLE;
                  return (
                    <tr
                      key={r.id}
                      className={`${rowBg} border-b border-l-4 border-slate-100 last:border-0 dark:border-slate-700 ${stripStyle}`}
                    >
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-1.5 font-bold text-slate-900 dark:text-white">
                          {r.roomNumber}
                          {delayed && (
                            <span title="Past its cleaning deadline — flagged for Theft Protection review" className="text-red-500">
                              ⚠
                            </span>
                          )}
                        </div>
                        <div className="text-xs font-normal text-slate-400 dark:text-slate-500">{r.roomCategory?.name ?? 'Uncategorized'}</div>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STATUS_BADGE_STYLE[status]}`}>
                          {STATUS_LABEL[status]}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 font-medium text-slate-900 dark:text-white">
                        {r.currentStay ? r.currentStay.guestName : <span className="font-normal text-slate-400 dark:text-slate-500">Vacant</span>}
                      </td>
                      <td className="px-5 py-3.5 text-slate-600 dark:text-slate-300">
                        {r.currentStay ? formatDateShort(r.currentStay.checkIn) : '—'}
                      </td>
                      <td className="px-5 py-3.5 text-slate-600 dark:text-slate-300">
                        {r.currentStay ? formatDateShort(r.currentStay.checkOut) : '—'}
                      </td>
                      <td className="px-5 py-3.5">
                        {!r.currentStay ? (
                          <span className="text-slate-400 dark:text-slate-500">—</span>
                        ) : due > 0 ? (
                          <div className="flex flex-col gap-0.5">
                            <span className="w-fit rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                              ₹{due % 1 === 0 ? due : due.toFixed(2)} due
                            </span>
                            <span className="text-[10px] text-slate-400 dark:text-slate-500">₹{Number(r.currentStay.paidAmount ?? 0).toFixed(2)} paid</span>
                          </div>
                        ) : (
                          <span className="w-fit rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                            ₹{Number(r.currentStay.paidAmount ?? 0).toFixed(2)}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        {r.currentStay && (
                          <span title={SOURCE_LABEL[r.currentStay.source] ?? r.currentStay.source}>
                            <ChannelIcon source={r.currentStay.source} className="h-5 w-5" />
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        {status === 'available' && canCheckIn && (
                          <Button variant="secondary" className="text-xs" onClick={() => setCheckInRoom(r)}>
                            Check in
                          </Button>
                        )}
                        {(status === 'occupied' || status === 'departing_today') && canCheckIn && (
                          <Button
                            variant="secondary"
                            className="text-xs"
                            disabled={checkingOutId === r.currentStay?.id}
                            onClick={() => checkOutGuest(r)}
                          >
                            {checkingOutId === r.currentStay?.id ? 'Checking out…' : 'Check out'}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {checkInRoom && (
        <CheckInModal room={checkInRoom} hotelId={hotelId} onClose={() => setCheckInRoom(null)} onDone={refresh} />
      )}
    </div>
  );
}
