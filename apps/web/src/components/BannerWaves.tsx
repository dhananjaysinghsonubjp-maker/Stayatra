// §user request, with a reference gif/screenshot as the target — a two-tone wavy "ocean" strip
// pinned to the very bottom of the hotel banner, continuously scrolling (two layers at different
// speeds for a little depth), plus a dark fin that glides right-to-left across it in one smooth,
// slow 8s pass once the water's 3s fade-in finishes, then the whole strip fades back out over 3s
// once the fin is gone. All the motion is plain CSS (banner-wave-back/-front/-shark-fin in
// index.css) — nothing here is randomized or recomputed per cycle, so there's no need for JS.
//
// The fin is taller than the wave strip itself (so a good chunk of it reads as rising up out of
// the water, not just peeking over it) — it sits in its own untrimmed wrapper, with the wave tiles
// kept in a shorter, separately clipped one so their repeat doesn't show a seam.
const WAVE_BACK = encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="24" viewBox="0 0 100 24"><path d="M0 12 Q 25 22 50 12 Q 75 2 100 12 L100 24 L0 24 Z" fill="#7dd3fc"/></svg>',
);
const WAVE_FRONT = encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="18" viewBox="0 0 120 18"><path d="M0 9 Q 30 18 60 9 Q 90 0 120 9 L120 18 L0 18 Z" fill="#22d3ee"/></svg>',
);

export function BannerWaves() {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 sm:h-12" aria-hidden="true">
      <div className="absolute inset-x-0 bottom-0 h-5 overflow-hidden sm:h-6">
        <div
          className="banner-wave-back absolute inset-x-0 bottom-0 h-full"
          style={{ backgroundImage: `url("data:image/svg+xml,${WAVE_BACK}")`, backgroundRepeat: 'repeat-x', backgroundSize: '100px 100%' }}
        />
        <div
          className="banner-wave-front absolute inset-x-0 bottom-0 h-4 sm:h-5"
          style={{ backgroundImage: `url("data:image/svg+xml,${WAVE_FRONT}")`, backgroundRepeat: 'repeat-x', backgroundSize: '120px 100%' }}
        />
      </div>
      {/* Classic shark-fin silhouette — pointed top, flat base, one curved trailing edge — matching
          the reference screenshot's own fin, dark enough to read as "poking up through" the wave
          band in front of it (DOM order: waves are painted first, this fin last/on top). Bigger
          than the wave strip itself per feedback, so it isn't clipped by that strip's own
          overflow-hidden. */}
      <svg className="banner-shark-fin absolute bottom-0 h-8 w-8 sm:h-9 sm:w-9" viewBox="0 0 24 24" fill="#0b1240">
        <path d="M12 2 C 9 9 8 15 8 20 L19 20 C 14 16 12.5 9 12 2 Z" />
      </svg>
    </div>
  );
}
