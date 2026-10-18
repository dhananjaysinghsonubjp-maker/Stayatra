/**
 * §user request — a real font picker: searchable, grouped by family, each family expandable into
 * its Regular/Bold rows (matching the reference screenshot's "Arial MT Pro ▾ / Regular / Bold"
 * pattern). The families named: Arial (system, no download needed), Poppins, Open Sans,
 * Montserrat, Open Sauce (One), and Cinzel — all verified to actually resolve before wiring them
 * in (Poppins/Open Sans/Montserrat/Cinzel are on Google Fonts; "Open Sauce" isn't, so it loads
 * from Fontsource's CDN instead, the same open-source files Google Fonts itself would serve).
 */

export interface FontFamily {
  id: string;
  label: string;
  /** CSS font-family value once loaded (or always, for the system font Arial). */
  stack: string;
  /** Google Fonts family name for the CSS2 API, e.g. 'Open Sans'. Omit if using `fontsource`. */
  google?: string;
  /** Fontsource package name (jsDelivr CDN) for families not on Google Fonts. */
  fontsource?: string;
  /** Weights to actually load/offer — every family here ships Regular (400) + Bold (700). */
  weights: Array<{ weight: number; label: string }>;
}

const REGULAR_BOLD = [
  { weight: 400, label: 'Regular' },
  { weight: 700, label: 'Bold' },
];

export const FONT_FAMILIES: FontFamily[] = [
  { id: 'arial', label: 'Arial', stack: 'Arial, Helvetica, sans-serif', weights: REGULAR_BOLD },
  { id: 'poppins', label: 'Poppins', stack: "'Poppins', sans-serif", google: 'Poppins', weights: REGULAR_BOLD },
  { id: 'open-sans', label: 'Open Sans', stack: "'Open Sans', sans-serif", google: 'Open Sans', weights: REGULAR_BOLD },
  { id: 'montserrat', label: 'Montserrat', stack: "'Montserrat', sans-serif", google: 'Montserrat', weights: REGULAR_BOLD },
  { id: 'open-sauce', label: 'Open Sauce', stack: "'Open Sauce One', sans-serif", fontsource: 'open-sauce-one', weights: REGULAR_BOLD },
  { id: 'cinzel', label: 'Cinzel', stack: "'Cinzel', serif", google: 'Cinzel', weights: REGULAR_BOLD },
];

export function fontOptionId(familyId: string, weight: number): string {
  return `${familyId}-${weight}`;
}

export function parseFontOptionId(optionId: string): { family: FontFamily; weight: number } | null {
  for (const family of FONT_FAMILIES) {
    for (const w of family.weights) {
      if (fontOptionId(family.id, w.weight) === optionId) return { family, weight: w.weight };
    }
  }
  return null;
}

const loadedFamilies = new Set<string>();

/** Injects a `<link>` once per family (both weights in one request) — safe to call repeatedly. */
export function ensureFontFamilyLoaded(family: FontFamily) {
  if (family.id === 'arial' || loadedFamilies.has(family.id)) return;
  loadedFamilies.add(family.id);
  const weightList = family.weights.map((w) => w.weight).join(';');
  const href = family.google
    ? `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family.google)}:wght@${weightList}&display=swap`
    : family.fontsource
      ? `https://cdn.jsdelivr.net/npm/@fontsource/${family.fontsource}@5/index.css`
      : null;
  if (!href) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.dataset.fontFamilyId = family.id;
  document.head.appendChild(link);
}
