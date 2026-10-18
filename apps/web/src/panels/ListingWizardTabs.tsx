// Shared progress bar for the "List Your Property" wizard (BasicInfoStep, RoomsStep,
// PoliciesStep, AmenitiesStep, PhotosAndVideosStep, FinanceAndLegalStep) — kept in one
// place so step order/labels can't drift between them.
export const WIZARD_STEPS = ['Location', 'Basic Info', 'Rooms', 'Policies', 'Amenities', 'Photos And Videos', 'Finance & Legal'];

export function StepTabs({ current }: { current: number }) {
  return (
    <div className="flex shrink-0 justify-center gap-10 border-b border-slate-200 px-10">
      {WIZARD_STEPS.map((label, i) => {
        const n = i + 1;
        const done = n < current;
        const isCurrent = n === current;
        return (
          <div
            key={label}
            className={`flex shrink-0 items-center gap-2 border-b-2 pb-3 pt-4 text-sm font-medium ${
              isCurrent ? 'border-brand-600 text-slate-900' : done ? 'border-transparent text-slate-500' : 'border-transparent text-slate-300'
            }`}
          >
            {done && <span className="text-emerald-600">✓</span>}
            {label}
          </div>
        );
      })}
    </div>
  );
}
