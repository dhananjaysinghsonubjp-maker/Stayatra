import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../../components/ui';

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

// 0deg = 12 o'clock (straight up), increasing clockwise — used for both the hand's CSS rotation
// and each number's position around the dial, so the two stay in sync.
function clockAngle(value: number, field: 'hour' | 'minute') {
  return field === 'hour' ? (value % 12) * 30 : value * 6;
}

// Inverse of clockAngle — a pointer position relative to the dial's center, turned back into a
// clock value. Same 0deg-at-12-o'clock, clockwise convention.
function angleToValue(deg: number, field: 'hour' | 'minute') {
  if (field === 'hour') {
    const h = Math.round(deg / 30) % 12;
    return h === 0 ? 12 : h;
  }
  return Math.round(deg / 6) % 60;
}

/**
 * §user request — "time mein jo screenshot share kiya vesa clock chahiye": a real analog
 * clock-face time picker (digital HH:MM readout + AM/PM + a dial you tap a number on), matching
 * the reference app's own time picker, rebuilt in our brand blue instead of its green.
 */
export function ClockTimePicker({
  label,
  value,
  onApply,
  onClose,
}: {
  label: string;
  value: string; // "HH:MM", 24-hour
  onApply: (hhmm: string) => void;
  onClose: () => void;
}) {
  const [h24, m] = value.split(':').map(Number);
  const [field, setField] = useState<'hour' | 'minute'>('hour');
  const [hour12, setHour12] = useState(h24 % 12 === 0 ? 12 : h24 % 12);
  const [minute, setMinute] = useState(m);
  const [period, setPeriod] = useState<'AM' | 'PM'>(h24 >= 12 ? 'PM' : 'AM');
  // §user request — "kaafi smooth hona chahiye, moveable": the hand tracks the pointer 1:1 while
  // actually being dragged (no transition lag fighting the drag), and only eases between values
  // for an ordinary tap/click or a programmatic change.
  const [dragging, setDragging] = useState(false);
  const dialRef = useRef<HTMLDivElement>(null);

  function apply() {
    const hour24 = period === 'AM' ? (hour12 === 12 ? 0 : hour12) : hour12 === 12 ? 12 : hour12 + 12;
    onApply(`${pad2(hour24)}:${pad2(minute)}`);
  }

  const size = 240;
  const center = size / 2;
  const radius = center - 28;
  const numbers = field === 'hour' ? Array.from({ length: 12 }, (_, i) => (i === 0 ? 12 : i)) : Array.from({ length: 12 }, (_, i) => i * 5);
  const selectedValue = field === 'hour' ? hour12 : minute;
  const handAngle = clockAngle(field === 'hour' ? (hour12 === 12 ? 0 : hour12) : minute, field);

  function pickNumber(n: number) {
    if (field === 'hour') {
      setHour12(n);
      setField('minute');
    } else {
      setMinute(n);
    }
  }

  function setFromPointer(clientX: number, clientY: number) {
    const rect = dialRef.current?.getBoundingClientRect();
    if (!rect) return;
    const dx = clientX - (rect.left + rect.width / 2);
    const dy = clientY - (rect.top + rect.height / 2);
    let deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
    if (deg < 0) deg += 360;
    const v = angleToValue(deg, field);
    if (field === 'hour') setHour12(v);
    else setMinute(v);
  }

  function onDialPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    setFromPointer(e.clientX, e.clientY);
  }
  function onDialPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (e.buttons !== 1) return;
    setFromPointer(e.clientX, e.clientY);
  }
  function onDialPointerUp() {
    setDragging(false);
    if (field === 'hour') setField('minute');
  }

  return createPortal(
    <div className="fixed inset-0 z-[67] flex items-center justify-center bg-slate-900/60 p-4">
      <div className="w-full max-w-xs rounded-2xl bg-white p-5 shadow-2xl">
        <p className="mb-4 text-sm font-bold text-slate-900">{label}</p>

        <div className="mb-5 flex items-center gap-3">
          <div className="flex items-center gap-1 text-4xl font-bold">
            <button
              type="button"
              onClick={() => setField('hour')}
              className={`rounded-lg px-2 py-1 ${field === 'hour' ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-900'}`}
            >
              {pad2(hour12)}
            </button>
            <span className="text-slate-400">:</span>
            <button
              type="button"
              onClick={() => setField('minute')}
              className={`rounded-lg px-2 py-1 ${field === 'minute' ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-900'}`}
            >
              {pad2(minute)}
            </button>
          </div>
          <div className="ml-auto flex flex-col overflow-hidden rounded-lg border border-slate-200">
            <button
              type="button"
              onClick={() => setPeriod('AM')}
              className={`px-3 py-1.5 text-xs font-bold ${period === 'AM' ? 'bg-brand-600 text-white' : 'bg-white text-slate-500'}`}
            >
              AM
            </button>
            <button
              type="button"
              onClick={() => setPeriod('PM')}
              className={`px-3 py-1.5 text-xs font-bold ${period === 'PM' ? 'bg-brand-600 text-white' : 'bg-white text-slate-500'}`}
            >
              PM
            </button>
          </div>
        </div>

        <div
          ref={dialRef}
          onPointerDown={onDialPointerDown}
          onPointerMove={onDialPointerMove}
          onPointerUp={onDialPointerUp}
          onPointerCancel={onDialPointerUp}
          className="relative mx-auto mb-5 touch-none select-none"
          style={{ width: size, height: size }}
        >
          <div className="absolute inset-0 rounded-full bg-slate-100" />
          <div
            className={`absolute left-1/2 top-1/2 h-0.5 origin-top bg-brand-600 ${dragging ? '' : 'transition-transform duration-150 ease-out'}`}
            style={{ height: radius, transform: `translateX(-50%) rotate(${handAngle}deg)` }}
          />
          <div className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-600" />
          {numbers.map((n) => {
            const angle = clockAngle(field === 'hour' && n === 12 ? 0 : n, field);
            const rad = ((angle - 90) * Math.PI) / 180;
            const x = center + radius * Math.cos(rad);
            const y = center + radius * Math.sin(rad);
            const selected = n === selectedValue;
            return (
              <button
                key={n}
                type="button"
                onClick={() => pickNumber(n)}
                className={`absolute flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-sm font-semibold transition-colors ${
                  selected ? 'bg-brand-600 text-white' : 'text-slate-700 hover:bg-slate-200'
                }`}
                style={{ left: x, top: y }}
              >
                {pad2(n)}
              </button>
            );
          })}
        </div>

        <div className="flex justify-end gap-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={apply}>
            OK
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
