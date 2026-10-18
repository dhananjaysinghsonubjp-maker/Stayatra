/**
 * §user request — "ek brand apne colour theme ke according set kar sakta hai": a single hex
 * colour a hotel picks in Settings, applied app-wide. The whole app's buttons/headings/badges
 * already read `bg-brand-600`/`text-brand-600`/etc., and Tailwind v4 compiles those classes to
 * `var(--color-brand-600)` rather than a baked-in hex (confirmed in the built CSS) — so overriding
 * that one CSS custom property on `<html>` re-themes every one of those classes at once, with no
 * per-component changes needed. We only derive the handful of shades (50/100/500/600/700) the app
 * actually uses, keeping hue/saturation from the picked colour and sliding lightness per shade.
 */

const SHADE_LIGHTNESS: Record<'50' | '100' | '500' | '700', number> = {
  '50': 96,
  '100': 91,
  '500': 58,
  '700': 34,
};

const CSS_VARS = ['--color-brand-50', '--color-brand-100', '--color-brand-500', '--color-brand-600', '--color-brand-700'];

export function isValidHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h * 360, s * 100, l * 100];
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

/** The picked colour becomes the 600 shade as-is; the rest are the same hue/saturation at
 * different lightness, so the ramp always reads as "the same colour, different depth." */
export function deriveBrandShades(baseHex: string): Record<'50' | '100' | '500' | '600' | '700', string> {
  const [r, g, b] = hexToRgb(baseHex);
  const [h, s] = rgbToHsl(r, g, b);
  const cappedS = Math.min(s, 70); // very saturated picks still get soft 50/100 tints, not neon ones
  return {
    '50': hslToHex(h, cappedS, SHADE_LIGHTNESS['50']),
    '100': hslToHex(h, cappedS, SHADE_LIGHTNESS['100']),
    '500': hslToHex(h, s, SHADE_LIGHTNESS['500']),
    '600': baseHex,
    '700': hslToHex(h, s, SHADE_LIGHTNESS['700']),
  };
}

const DEFAULT_BANNER_BG = '#4f46e5'; // matches DEFAULT_BRAND_COLOR in Onboarding.tsx

/** §user request — the banner's icons shouldn't sit in their own circle; they should just change
 * colour to match the banner: white on a dark brand colour, dark on a light one. Standard
 * perceived-brightness formula (not plain average — the eye weighs green much more than blue). */
export function isColorDark(hex: string | null | undefined): boolean {
  const safe = hex && isValidHexColor(hex) ? hex : DEFAULT_BANNER_BG;
  const [r, g, b] = hexToRgb(safe);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness < 128;
}

/** `null`/invalid reverts to the app's default indigo by clearing the inline override — the
 * `:root` values from index.css take back over. */
export function applyBrandColor(hex: string | null | undefined) {
  const root = document.documentElement;
  if (!hex || !isValidHexColor(hex)) {
    for (const v of CSS_VARS) root.style.removeProperty(v);
    return;
  }
  const shades = deriveBrandShades(hex);
  root.style.setProperty('--color-brand-50', shades['50']);
  root.style.setProperty('--color-brand-100', shades['100']);
  root.style.setProperty('--color-brand-500', shades['500']);
  root.style.setProperty('--color-brand-600', shades['600']);
  root.style.setProperty('--color-brand-700', shades['700']);
}
