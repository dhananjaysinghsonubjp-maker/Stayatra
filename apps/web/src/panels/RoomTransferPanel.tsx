import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { mutate, ApiError } from '../api';
import { useAuth } from '../AuthContext';
import { Badge, Button, Field, inputClass } from '../components/ui';
import type { Booking, Room } from '../types';

type Reason = 'maintenance' | 'upgrade' | 'other';
type BillingMode = 'keep' | 'category_rate' | 'custom';

const REASON_LABEL: Record<Reason, string> = { maintenance: 'Maintenance', upgrade: 'Upgrade', other: 'Other' };

/**
 * §user request, with a reference app's own "Room Transfer" panel as the explicit visual target —
 * replaces the old plain same-category-only room dropdown with: any room in any category (an
 * actual upgrade/downgrade, not just a same-type swap), a required reason, and a billing choice
 * (keep the current per-night price / pick up the new category's own standard rate / set a custom
 * one). Opened from a room's own "⋮" menu in the Booking Details page, same as the old "Change
 * room" action it replaces.
 */
export function RoomTransferPanel({
  hotelId: _hotelId,
  booking,
  rooms,
  onClose,
  onChanged,
}: {
  hotelId: string;
  booking: Booking;
  rooms: Room[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const { token } = useAuth();
  const currentRoom = rooms.find((r) => r.id === booking.assignedRoomId);

  const [entered, setEntered] = useState(false);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);
  function handleClose() {
    setClosing(true);
    setTimeout(onClose, 220);
  }

  const candidateRooms = rooms.filter((r) => r.status === 'available' && r.id !== booking.assignedRoomId && r.roomCategoryId);
  const categories = (() => {
    const seen = new Map<string, string>();
    for (const r of candidateRooms) {
      if (r.roomCategoryId && r.roomCategory && !seen.has(r.roomCategoryId)) seen.set(r.roomCategoryId, r.roomCategory.name);
    }
    return [...seen.entries()];
  })();

  const [categoryId, setCategoryId] = useState(booking.roomCategoryId && categories.some(([id]) => id === booking.roomCategoryId) ? booking.roomCategoryId : (categories[0]?.[0] ?? ''));
  const [roomId, setRoomId] = useState('');
  const [reason, setReason] = useState<Reason | ''>('');
  const [billingMode, setBillingMode] = useState<BillingMode>('keep');
  const [customRate, setCustomRate] = useState<number | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const roomsInCategory = candidateRooms.filter((r) => r.roomCategoryId === categoryId);
  const currentRatePerNight = booking.nights > 0 ? Number(booking.totalAmount) / booking.nights : Number(booking.totalAmount);
  const selectedCategoryName = categories.find(([id]) => id === categoryId)?.[1] ?? '—';

  async function confirm() {
    if (!roomId || !reason) return;
    setBusy(true);
    setError(null);
    try {
      await mutate(
        'bookings.transferRoom',
        {
          bookingId: booking.id,
          newRoomId: roomId,
          reason,
          billingMode,
          customRatePerNight: billingMode === 'custom' ? (customRate === '' ? undefined : customRate) : undefined,
        },
        token ?? undefined,
      );
      onChanged();
      handleClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to transfer room');
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div
      className={`fixed inset-0 z-[55] flex justify-end bg-slate-900/40 transition-opacity duration-200 ${entered && !closing ? 'opacity-100' : 'opacity-0'}`}
      onClick={() => !busy && handleClose()}
    >
      <div
        className={`flex h-full w-full min-w-0 max-w-md flex-col overflow-hidden bg-white shadow-2xl transition-transform duration-200 ease-out dark:bg-slate-800 ${
          entered && !closing ? 'translate-x-0' : 'translate-x-full'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-700">
          <div className="min-w-0">
            <h3 className="truncate text-lg font-bold text-slate-900 dark:text-white">Room Transfer</h3>
            <p className="truncate text-xs text-slate-400 dark:text-slate-500">
              Moving guest from Room {currentRoom?.roomNumber ?? '—'} ({currentRoom?.roomCategory?.name ?? '—'})
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700"
          >
            ✕
          </button>
        </div>

        <div className="min-w-0 flex-1 space-y-4 overflow-y-auto p-5">
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <Field label="Select Room Type">
            <select
              className={inputClass}
              value={categoryId}
              onChange={(e) => {
                setCategoryId(e.target.value);
                setRoomId('');
              }}
            >
              <option value="">— select room type —</option>
              {categories.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </Field>

          {categoryId && (
            <div className="space-y-2">
              {roomsInCategory.length === 0 ? (
                <p className="text-sm text-slate-400 dark:text-slate-500">No available rooms in this category.</p>
              ) : (
                roomsInCategory.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setRoomId(r.id)}
                    className={`flex w-full items-center justify-between rounded-xl border p-3 text-left transition-colors ${
                      roomId === r.id
                        ? 'border-brand-500 ring-1 ring-brand-500 dark:border-brand-400 dark:ring-brand-400'
                        : 'border-slate-200 hover:border-slate-300 dark:border-slate-600 dark:hover:border-slate-500'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-slate-900 dark:text-white">Room {r.roomNumber}</p>
                      <p className="truncate text-xs text-slate-400 dark:text-slate-500">{r.roomCategory?.name}</p>
                    </div>
                    <Badge tone="available">Available</Badge>
                  </button>
                ))
              )}
            </div>
          )}

          <Field label="Reason for Move">
            <select className={inputClass} value={reason} onChange={(e) => setReason(e.target.value as Reason)}>
              <option value="">— select —</option>
              {(Object.keys(REASON_LABEL) as Reason[]).map((r) => (
                <option key={r} value={r}>
                  {REASON_LABEL[r]}
                </option>
              ))}
            </select>
          </Field>

          <div>
            <p className="mb-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">Billing</p>
            <div className="space-y-2">
              <label
                className={`flex cursor-pointer items-center justify-between rounded-xl border p-3 ${
                  billingMode === 'keep' ? 'border-brand-500 ring-1 ring-brand-500 dark:border-brand-400 dark:ring-brand-400' : 'border-slate-200 dark:border-slate-600'
                }`}
              >
                <span>
                  <span className="block text-sm font-semibold text-slate-900 dark:text-white">Keep current rate</span>
                  <span className="block text-xs text-slate-400 dark:text-slate-500">₹{currentRatePerNight.toFixed(0)}/night</span>
                </span>
                <input type="radio" checked={billingMode === 'keep'} onChange={() => setBillingMode('keep')} className="h-4 w-4 text-brand-600 focus:ring-brand-500" />
              </label>
              <label
                className={`flex cursor-pointer items-center justify-between rounded-xl border p-3 ${
                  billingMode === 'category_rate' ? 'border-brand-500 ring-1 ring-brand-500 dark:border-brand-400 dark:ring-brand-400' : 'border-slate-200 dark:border-slate-600'
                }`}
              >
                <span>
                  <span className="block text-sm font-semibold text-slate-900 dark:text-white">Update to {selectedCategoryName} standard rate</span>
                  <span className="block text-xs text-slate-400 dark:text-slate-500">Applied automatically on confirm</span>
                </span>
                <input
                  type="radio"
                  checked={billingMode === 'category_rate'}
                  onChange={() => setBillingMode('category_rate')}
                  className="h-4 w-4 text-brand-600 focus:ring-brand-500"
                />
              </label>
              <label
                className={`flex cursor-pointer items-center justify-between rounded-xl border p-3 ${
                  billingMode === 'custom' ? 'border-brand-500 ring-1 ring-brand-500 dark:border-brand-400 dark:ring-brand-400' : 'border-slate-200 dark:border-slate-600'
                }`}
              >
                <span className="text-sm font-semibold text-slate-900 dark:text-white">Change Custom Price</span>
                <input type="radio" checked={billingMode === 'custom'} onChange={() => setBillingMode('custom')} className="h-4 w-4 text-brand-600 focus:ring-brand-500" />
              </label>
              {billingMode === 'custom' && (
                <Field label="Custom Price (per night)">
                  <input
                    type="number"
                    min={0}
                    className={inputClass}
                    placeholder="Enter custom price"
                    value={customRate}
                    onChange={(e) => setCustomRate(e.target.value === '' ? '' : Number(e.target.value))}
                  />
                </Field>
              )}
            </div>
          </div>
        </div>

        <div className="flex gap-2 border-t border-slate-100 p-4 dark:border-slate-700">
          <Button type="button" variant="secondary" className="flex-1" onClick={handleClose}>
            Cancel
          </Button>
          <Button type="button" className="flex-1" disabled={busy || !roomId || !reason} onClick={confirm}>
            {busy ? 'Confirming…' : 'Confirm'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
