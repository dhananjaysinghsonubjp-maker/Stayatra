// §user request, with a reference gif/screenshot as the target — a two-tone wavy "ocean" strip
// pinned to the very bottom of the hotel banner, continuously scrolling (two layers at different
// speeds for a little depth), plus a dark fin that surfaces and swims across every 20s. All the
// motion is plain CSS (banner-wave-back/-front/-shark-fin in index.css) — nothing here is
// randomized or recomputed per cycle, so there's no need for JS-driven animation.
const WAVE_BACK = encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="24" viewBox="0 0 100 24"><path d="M0 12 Q 25 22 50 12 Q 75 2 100 12 L100 24 L0 24 Z" fill="#7dd3fc"/></svg>',
);
const WAVE_FRONT = encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="18" viewBox="0 0 120 18"><path d="M0 9 Q 30 18 60 9 Q 90 0 120 9 L120 18 L0 18 Z" fill="#22d3ee"/></svg>',
);

export function BannerWaves() {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-5 overflow-hidden sm:h-6" aria-hidden="true">
      <div
        className="banner-wave-back absolute inset-x-0 bottom-0 h-full"
        style={{ backgroundImage: `url("data:image/svg+xml,${WAVE_BACK}")`, backgroundRepeat: 'repeat-x', backgroundSize: '100px 100%' }}
      />
      <div
        className="banner-wave-front absolute inset-x-0 bottom-0 h-4 sm:h-5"
        style={{ backgroundImage: `url("data:image/svg+xml,${WAVE_FRONT}")`, backgroundRepeat: 'repeat-x', backgroundSize: '120px 100%' }}
      />
      <svg className="banner-shark-fin absolute bottom-1.5 h-3 w-3 sm:h-4 sm:w-4" viewBox="0 0 24 24" fill="#0b1240">
        <path d="M12 1 C 8.5 7 8.5 15 12 22 C 15.5 15 15.5 7 12 1 Z" />
      </svg>
    </div>
  );
}
