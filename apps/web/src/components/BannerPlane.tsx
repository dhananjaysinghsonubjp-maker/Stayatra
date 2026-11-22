import { useEffect, useRef, useState } from 'react';

// §user request, with a reference image's own climbing flight path as the target (not its plane
// photo — "uska sirf path lena hai") — a small paper-plane glyph enters from the banner's bottom
// left, climbs and curves out past the right edge trailing a dashed, fading contrail, visible for
// 5s out of every 30s. "Path random rahega" — a fresh random cubic-bezier curve every cycle, not
// the same flight repeating.
const CYCLE_MS = 30000;
const FLIGHT_MS = 4300;
const FADE_MS = 700; // fold into the same 5s visible window (4300 + 700 = 5000)

type Point = [number, number];
interface Curve {
  p0: Point;
  p1: Point;
  p2: Point;
  p3: Point;
}

function randomCurve(): Curve {
  const startY = 78 + Math.random() * 18; // near the bottom edge
  const endY = 8 + Math.random() * 45; // somewhere from top to center on exit
  return {
    p0: [-3 + Math.random() * 5, startY],
    p1: [14 + Math.random() * 18, startY - (22 + Math.random() * 28)],
    p2: [54 + Math.random() * 20, endY + (Math.random() * 24 - 12)],
    p3: [100 + Math.random() * 4, endY],
  };
}

function cubicPoint({ p0, p1, p2, p3 }: Curve, t: number): Point {
  const mt = 1 - t;
  const a = mt ** 3;
  const b = 3 * mt ** 2 * t;
  const c = 3 * mt * t ** 2;
  const d = t ** 3;
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
}

function curveToPathD(curve: Curve): string {
  return `M ${curve.p0[0]} ${curve.p0[1]} C ${curve.p1[0]} ${curve.p1[1]}, ${curve.p2[0]} ${curve.p2[1]}, ${curve.p3[0]} ${curve.p3[1]}`;
}

/** A small decorative flight animation for a hotel's banner — mount it inside a `relative
 * overflow-hidden` container. Purely cosmetic (aria-hidden, pointer-events-none), driven by
 * requestAnimationFrame rather than CSS keyframes since the curve itself changes every cycle. */
export function BannerPlane() {
  const [curve, setCurve] = useState<Curve>(() => randomCurve());
  const [progress, setProgress] = useState(0);
  const [opacity, setOpacity] = useState(0);
  const cycleStartRef = useRef(0);

  useEffect(() => {
    let raf: number;
    cycleStartRef.current = performance.now();

    function tick(now: number) {
      const elapsed = now - cycleStartRef.current;
      if (elapsed < FLIGHT_MS) {
        setProgress(elapsed / FLIGHT_MS);
        setOpacity(Math.min(1, elapsed / 300));
      } else if (elapsed < FLIGHT_MS + FADE_MS) {
        setProgress(1);
        setOpacity(1 - (elapsed - FLIGHT_MS) / FADE_MS);
      } else if (elapsed < CYCLE_MS) {
        setOpacity(0);
      } else {
        cycleStartRef.current = now;
        setCurve(randomCurve());
        setProgress(0);
        setOpacity(0);
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const [x, y] = cubicPoint(curve, progress);
  const [nx, ny] = cubicPoint(curve, Math.min(1, progress + 0.01));
  const angle = (Math.atan2(ny - y, nx - x) * 180) / Math.PI;

  if (opacity <= 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
        <path
          d={curveToPathD(curve)}
          fill="none"
          stroke="white"
          strokeWidth={0.5}
          strokeDasharray="1.8 1.8"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          style={{ opacity: opacity * 0.6 }}
        />
      </svg>
      <div
        className="absolute text-white drop-shadow"
        style={{ left: `${x}%`, top: `${y}%`, opacity, transform: `translate(-50%, -50%) rotate(${angle}deg)` }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path d="M2 12 L22 4 L16 12 L22 20 Z" />
        </svg>
      </div>
    </div>
  );
}
