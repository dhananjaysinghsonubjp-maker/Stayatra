import { useEffect, useRef, useState } from 'react';
import { HexColorPicker } from 'react-colorful';
import { inputClass } from './ui';
import { isValidHexColor } from '../brandColor';

// The browser EyeDropper API isn't in TS's DOM lib yet (Chrome/Edge only, no Safari/Firefox) —
// a minimal ambient type keeps this typed without `any`/`@ts-expect-error` noise at every call site.
interface EyeDropperResult {
  sRGBHex: string;
}
interface EyeDropperConstructor {
  new (): { open(): Promise<EyeDropperResult> };
}
declare global {
  interface Window {
    EyeDropper?: EyeDropperConstructor;
  }
}

const supportsEyedropper = typeof window !== 'undefined' && 'EyeDropper' in window;

/** §user request, with a Figma/Canva-style picker screenshot as the target — a rich swatch
 * trigger that opens a popover with a 2D saturation/lightness square + hue slider
 * (react-colorful's HexColorPicker draws both in one piece), a hex field with a screen eyedropper,
 * and the existing preset swatches. No "Gradient" tab — the brand colour only ever drives solid
 * CSS variables (deriveBrandShades), so a gradient mode would have nothing to apply to. */
export function BrandColorPicker({
  value,
  onChange,
  presets,
}: {
  value: string;
  onChange: (hex: string) => void;
  presets: { hex: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [hexDraft, setHexDraft] = useState(value);

  useEffect(() => setHexDraft(value), [value]);

  function toggle() {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const estimatedHeight = 360;
      setOpenUp(window.innerHeight - rect.bottom < estimatedHeight && rect.top > estimatedHeight);
    }
    setOpen((o) => !o);
  }

  function commitHex(raw: string) {
    const v = raw.startsWith('#') ? raw : `#${raw}`;
    setHexDraft(v);
    if (isValidHexColor(v)) onChange(v);
  }

  async function pickWithEyedropper() {
    if (!window.EyeDropper) return;
    try {
      const result = await new window.EyeDropper().open();
      setHexDraft(result.sRGBHex);
      onChange(result.sRGBHex);
    } catch {
      // user pressed Escape / cancelled the pick — nothing to do
    }
  }

  const swatchColor = isValidHexColor(value) ? value : '#ffffff';

  return (
    <div className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        className="h-12 w-12 shrink-0 cursor-pointer rounded-lg border border-slate-200 shadow-sm transition-transform hover:scale-105 dark:border-slate-600"
        style={{ backgroundColor: swatchColor }}
        aria-label="Pick brand colour"
      />
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className={`brand-color-picker absolute left-0 z-50 w-72 rounded-2xl border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-slate-800 ${
              openUp ? 'bottom-full mb-2' : 'top-full mt-2'
            }`}
          >
            <HexColorPicker color={isValidHexColor(value) ? value : '#0c2171'} onChange={onChange} />

            <div className="mt-3 flex items-center gap-2">
              <div className="h-9 w-9 shrink-0 rounded-lg border border-slate-200 dark:border-slate-600" style={{ backgroundColor: isValidHexColor(hexDraft) ? hexDraft : '#fff' }} />
              <input
                type="text"
                value={hexDraft}
                onChange={(e) => commitHex(e.target.value)}
                placeholder="#0C2171"
                className={`${inputClass} flex-1 font-mono uppercase`}
                maxLength={7}
              />
              {supportsEyedropper && (
                <button
                  type="button"
                  onClick={() => void pickWithEyedropper()}
                  title="Pick a colour from your screen"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-400 dark:hover:bg-slate-700"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="m2 22 1-4 9.5-9.5" />
                    <path d="M14.5 6.5 18 3l3 3-3.5 3.5" />
                    <path d="m9 13 3 3" />
                  </svg>
                </button>
              )}
            </div>

            <p className="mb-1.5 mt-3 text-xs font-medium text-slate-500 dark:text-slate-400">Presets</p>
            <div className="flex flex-wrap gap-2">
              {presets.map((p) => (
                <button
                  key={p.hex}
                  type="button"
                  title={p.label}
                  onClick={() => onChange(p.hex)}
                  className={`h-7 w-7 rounded-full ring-2 ring-offset-2 transition-transform hover:scale-110 dark:ring-offset-slate-800 ${
                    value.toLowerCase() === p.hex.toLowerCase() ? 'ring-slate-400 dark:ring-slate-300' : 'ring-transparent'
                  }`}
                  style={{ backgroundColor: p.hex }}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
