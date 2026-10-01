import { OTA_LABEL } from './ota-labels';
import type { OtaConnection } from '../../types';

/** Multi-channel chip picker for Rate Update / Inventory Update — one bulk action can target several connected channels at once. */
export function ChannelMultiSelect({
  connections,
  selected,
  onChange,
}: {
  connections: OtaConnection[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  if (connections.length === 0) {
    return <p className="text-sm text-slate-400">No channels connected yet — connect one from Connected Channels first.</p>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {connections.map((c) => {
        const active = selected.includes(c.id);
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => toggle(c.id)}
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium ring-1 ring-inset transition-colors ${
              active ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-600 ring-slate-300 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700'
            }`}
          >
            {active ? <span className="mr-1">✓</span> : <span className="mr-1 text-slate-400">+</span>}
            {OTA_LABEL[c.otaCode] ?? c.otaCode}
          </button>
        );
      })}
    </div>
  );
}
