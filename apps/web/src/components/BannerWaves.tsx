// §user request, with a reference gif/screenshot as the target — a two-tone wavy "ocean" strip
// pinned to the very bottom of the hotel banner, continuously scrolling (two layers at different
// speeds for a little depth), plus a dark fin that surfaces and swims right-to-left across it over
// a smooth 5s, then the whole strip fades out until the next cycle 30s after the last one started.
// All the motion is plain CSS (banner-wave-back/-front/-shark-fin in index.css) — nothing here is
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
      {/* Classic shark-fin silhouette — pointed top, flat base, one curved trailing edge — matching
          the reference screenshot's own fin, dark enough to read as "poking up through" the wave
          band in front of it (DOM order: waves are painted first, this fin last/on top). */}
      <svg className="banner-shark-fin absolute bottom-1 h-4 w-4 sm:h-5 sm:w-5" viewBox="0 0 24 24" fill="#0b1240">
        <path d="M12 2 C 9 9 8 15 8 20 L19 20 C 14 16 12.5 9 12 2 Z" />
      </svg>
    </div>
  );
}
