import { Button, Card } from '../../components/ui';
import type { Room } from '../../types';

/** §user request, with a reference app's own "Add Room" screen as the visual target — every
 * physical room in one grid, a already-booked room shown dimmed/disabled (not hidden — the
 * front desk should see the whole property, not wonder why a room vanished), a selected room
 * gets the green checkmark. */
export function RoomPickerModal({
  rooms,
  checkIn,
  checkOut,
  selectedIds,
  onToggle,
  onClose,
  onContinue,
}: {
  rooms: (Room & { available: boolean })[];
  checkIn: string;
  checkOut: string;
  selectedIds: string[];
  onToggle: (roomId: string) => void;
  onClose: () => void;
  onContinue: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <Card className="flex max-h-[85vh] flex-col overflow-hidden rounded-b-none sm:rounded-b-xl">
          <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-700">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">Add Room</h3>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {checkIn} → {checkOut}
              </p>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300">
              ✕
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5">
            {rooms.length === 0 ? (
              <p className="text-sm text-slate-400 dark:text-slate-500">No rooms set up yet — add rooms from Settings → Room Setup.</p>
            ) : (
              <div className="grid grid-cols-3 gap-2.5">
                {rooms.map((r) => {
                  const selected = selectedIds.includes(r.id);
                  const disabled = !r.available && !selected;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => onToggle(r.id)}
                      title={disabled ? 'Already booked for these dates' : r.roomCategory?.name ?? ''}
                      className={`flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm font-semibold transition-colors ${
                        selected
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:border-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400'
                          : disabled
                            ? 'cursor-not-allowed border-slate-100 bg-slate-50 text-slate-300 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-600'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-brand-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                      }`}
                    >
                      {r.roomNumber}
                      {selected ? (
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 border-emerald-600 bg-emerald-600 text-white">✓</span>
                      ) : (
                        <span
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 text-xs ${
                            disabled ? 'border-slate-200 text-slate-200 dark:border-slate-700' : 'border-slate-300 text-slate-400 dark:border-slate-600'
                          }`}
                        >
                          +
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-5 py-4 dark:border-slate-700">
            <p className="text-xs text-slate-500 dark:text-slate-400">{selectedIds.length} room{selectedIds.length === 1 ? '' : 's'} selected</p>
            <Button type="button" onClick={onContinue} disabled={selectedIds.length === 0}>
              Continue
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
