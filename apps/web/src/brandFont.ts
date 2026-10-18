/**
 * §user request — "Font Setup (Adv feature)... by default jo font hai vahi rahega but kuch option
 * rakhenge": applied the same way brandColor.ts applies colour — overriding `--font-sans` on
 * `<html>`, which Tailwind v4's own base styles already read via
 * `--default-font-family: var(--font-sans)` (confirmed in the built CSS), so every bit of text in
 * the app picks it up with no per-component changes. The actual font catalogue (families, their
 * Regular/Bold weights, where each one loads from) lives in fontCatalog.ts.
 */
import { FONT_FAMILIES, parseFontOptionId, ensureFontFamilyLoaded } from './fontCatalog';

export const DEFAULT_FONT_STACK = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif";

export { FONT_FAMILIES };

export function fontStackFor(fontOptionId: string | null | undefined): string {
  const parsed = fontOptionId ? parseFontOptionId(fontOptionId) : null;
  return parsed?.family.stack ?? DEFAULT_FONT_STACK;
}

export function applyBrandFont(fontOptionId: string | null | undefined) {
  const root = document.documentElement;
  const parsed = fontOptionId ? parseFontOptionId(fontOptionId) : null;
  if (!parsed) {
    root.style.removeProperty('--font-sans');
    return;
  }
  // Load both weights of the family regardless of which specific row (Regular/Bold) was picked —
  // the app already uses font-normal/font-semibold/font-bold Tailwind classes all over, and all
  // of them need a real weight file available once the family changes.
  ensureFontFamilyLoaded(parsed.family);
  root.style.setProperty('--font-sans', parsed.family.stack);
}
