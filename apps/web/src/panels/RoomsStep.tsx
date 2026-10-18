import { useState } from 'react';
import { Button, inputClass } from '../components/ui';
import { StepTabs } from './ListingWizardTabs';

export interface RoomCategoryDraft {
  name: string;
  count: number;
}

export function RoomsStep({
  hotelName,
  onContinue,
  onBack,
  busy = false,
  serverError = null,
}: {
  hotelName: string;
  onContinue: (categories: RoomCategoryDraft[]) => void;
  onBack: () => void;
  busy?: boolean;
  serverError?: string | null;
}) {
  const [categories, setCategories] = useState<RoomCategoryDraft[]>([{ name: 'Deluxe Double', count: 4 }]);
  const [error, setError] = useState<string | null>(null);

  function updateRow(i: number, patch: Partial<RoomCategoryDraft>) {
    setCategories((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }

  function addRow() {
    setCategories((prev) => [...prev, { name: '', count: 1 }]);
  }

  function removeRow(i: number) {
    setCategories((prev) => prev.filter((_, idx) => idx !== i));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const cleaned = categories.map((c) => ({ name: c.name.trim(), count: c.count })).filter((c) => c.name);
    if (cleaned.length === 0) {
      setError('Add at least one room category.');
      return;
    }
    if (cleaned.some((c) => !c.count || c.count < 1)) {
      setError('Each category needs at least 1 room.');
      return;
    }
    setError(null);
    onContinue(cleaned);
  }

  const totalRooms = categories.reduce((sum, c) => sum + (Number(c.count) || 0), 0);

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-white">
      <StepTabs current={3} />
      <form onSubmit={submit} className="mx-auto w-full max-w-3xl flex-1 px-10 py-8">
        <h1 className="mb-6 text-2xl font-bold text-slate-900">Rooms</h1>

        <div className="rounded-xl border border-slate-200">
          <div className="border-b border-slate-100 px-6 py-5">
            <h2 className="text-lg font-semibold text-slate-900">Room Categories</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              What room types does {hotelName || 'your property'} have, and how many rooms in each?
            </p>
          </div>

          <div className="divide-y divide-slate-100 px-6">
            {categories.map((c, i) => (
              <div key={i} className="grid grid-cols-[1fr_140px_auto] items-end gap-4 py-4">
                <div>
                  {i === 0 && <p className="mb-1.5 text-xs font-medium text-slate-600">Category name</p>}
                  <input
                    className={inputClass}
                    value={c.name}
                    onChange={(e) => updateRow(i, { name: e.target.value })}
                    placeholder="e.g. Deluxe Double"
                  />
                </div>
                <div>
                  {i === 0 && <p className="mb-1.5 text-xs font-medium text-slate-600">No. of rooms</p>}
                  <input
                    className={inputClass}
                    type="number"
                    min={1}
                    value={c.count}
                    onChange={(e) => updateRow(i, { count: Number(e.target.value) })}
                  />
                </div>
                {categories.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeRow(i)}
                    aria-label="Remove this category"
                    title="Remove this category"
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-400 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 6h18" />
                      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                      <path d="M10 11v6" />
                      <path d="M14 11v6" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="border-t border-slate-100 px-6 py-4">
            <button type="button" onClick={addRow} className="text-sm font-medium text-brand-600 hover:underline">
              + Add another category
            </button>
          </div>
        </div>

        <p className="mt-3 text-xs text-slate-500">{totalRooms} room{totalRooms === 1 ? '' : 's'} total across {categories.filter((c) => c.name.trim()).length} categor{categories.filter((c) => c.name.trim()).length === 1 ? 'y' : 'ies'}.</p>

        {(error || serverError) && <p className="mt-4 text-sm text-red-600">{error || serverError}</p>}

        <div className="mt-6 flex items-center justify-between pb-8">
          <Button type="button" variant="ghost" onClick={onBack} disabled={busy}>
            ← Back
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Continue'}
          </Button>
        </div>
      </form>
    </div>
  );
}
