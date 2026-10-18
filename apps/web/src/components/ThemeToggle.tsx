import { useTheme } from '../ThemeContext';

// §user request — "icon ko circle me mt karo, simply colour change karo": used only when this
// icon sits on top of the banner (App.tsx), which has its own background colour to contrast
// against rather than the usual light/dark-mode slate. `tone` is omitted everywhere else, which
// keeps the existing slate-based look unchanged.
const TONE_CLASS: Record<'light' | 'dark', string> = {
  light: 'text-white hover:bg-white/15',
  dark: 'text-slate-900 hover:bg-black/10',
};

/** Dark/Light toggle (§ user request — "depends on mood of the customer, he wants to choose"). */
export function ThemeToggle({ tone }: { tone?: 'light' | 'dark' } = {}) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${tone ? TONE_CLASS[tone] : 'text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}
    >
      {isDark ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
          <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
        </svg>
      )}
    </button>
  );
}
