import { useState } from 'react';
import { Button } from '../components/ui';
import { StepTabs } from './ListingWizardTabs';

const AMENITY_CATALOG = [
  'Free WiFi', 'Parking', 'Swimming Pool', 'Restaurant', 'Bar', 'Fitness Centre / Gym', 'Spa',
  'Lift / Elevator', 'Power Backup', 'CCTV Surveillance', '24-Hour Front Desk', 'Air Conditioning',
  'Laundry Service', 'Travel Desk', 'Doctor on Call', 'Banquet / Conference Hall', 'Airport Transfer',
  'Pet Friendly', 'Wheelchair Accessible', 'Garden / Lawn', 'Bonfire Pit', 'Room Service',
];

export function AmenitiesStep({
  initial = [],
  onContinue,
  onBack,
  busy = false,
  serverError = null,
}: {
  initial?: string[];
  onContinue: (amenities: string[]) => void;
  onBack: () => void;
  busy?: boolean;
  serverError?: string | null;
}) {
  const [selected, setSelected] = useState<string[]>(initial);

  function toggle(a: string) {
    setSelected((prev) => (prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    onContinue(selected);
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-white">
      <StepTabs current={5} />
      <form onSubmit={submit} className="mx-auto w-full max-w-3xl flex-1 px-10 py-8">
        <h1 className="text-2xl font-bold text-slate-900">Amenities</h1>
        <p className="mb-6 mt-1 text-sm text-slate-500">Select all the amenities & facilities available at your property.</p>

        <div className="mb-6 rounded-xl border border-slate-200 px-6 py-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {AMENITY_CATALOG.map((a) => (
              <label key={a} className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                  checked={selected.includes(a)}
                  onChange={() => toggle(a)}
                />
                {a}
              </label>
            ))}
          </div>
        </div>

        {serverError && <p className="mb-4 text-sm text-red-600">{serverError}</p>}

        <div className="flex items-center justify-between pb-8">
          <Button type="button" variant="ghost" onClick={onBack} disabled={busy}>
            ← Back
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save and Continue'}
          </Button>
        </div>
      </form>
    </div>
  );
}
