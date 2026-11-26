import { useEffect, useState } from 'react';
import { query } from '../../api';
import { useAuth } from '../../AuthContext';
import type { Hotel } from '../../types';

/**
 * §user request, with a reference app's own Police Report / Day Wise Booking Report / Check-In
 * and Check-Out Report as the target — these generate straight into a printable document instead
 * of staying an on-screen table, the same way InvoicePrintView already does for a single booking's
 * invoice: the browser's own print dialog (`window.print()`, "Save as PDF" covers "download"),
 * isolated on the page via `.report-print-root`/`.no-print` in index.css.
 *
 * §bugfix — "print nikale toh sab kuch dikh jaye, scroll na karna pade": this used to cap itself
 * at `max-h-[75vh] overflow-auto` (a boxed preview with its own inner scrollbar) and the zoom
 * control resized that same box with a literal `width: <zoom>%` inline style — which also applied
 * at print time, since an inline style isn't scoped to a media query. A wide report (the Rooms
 * Report's 11-column table, for instance) printed cropped to whatever that box happened to be
 * sized to, with the rest only reachable by scrolling on screen, never in the actual printout.
 * Zoom is now a `transform: scale()` on its own class, explicitly cancelled in print (index.css),
 * and the preview box itself just flows in the normal page instead of boxing itself in — the
 * browser's own page scroll covers a tall report, and the print output always gets the full,
 * unscaled, un-clipped content regardless of whatever zoom level was last picked on screen.
 */
export function ReportPrintShell({
  hotelId,
  title,
  children,
  minimal,
  onClose,
}: {
  hotelId: string;
  title: string;
  children: React.ReactNode;
  /** §user request — "Customer List ka PDF directly dikhao ki bas print ka option ho": drops the
   * Fit page/Fit width/zoom/Download controls, leaving just Print (plus Close, if onClose is
   * given) — for a case that just needs "print this", not the full zoomable-preview toolbar every
   * other report in this app already uses. */
  minimal?: boolean;
  onClose?: () => void;
}) {
  const { token } = useAuth();
  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [zoom, setZoom] = useState(100);

  useEffect(() => {
    query<Hotel>('hotels.get', { hotelId }, token ?? undefined).then(setHotel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId]);

  const addressParts = hotel ? [hotel.addressLine, hotel.city, hotel.state, hotel.pincode].filter(Boolean) : [];

  return (
    <div className="report-print-root overflow-hidden rounded-xl border border-slate-700 shadow-sm print:overflow-visible print:rounded-none print:border-0 print:shadow-none">
      <div className="no-print flex flex-wrap items-center justify-between gap-2 bg-slate-800 px-4 py-2.5 text-sm text-white">
        <span className="font-semibold">{title}</span>
        <div className="flex items-center gap-1.5">
          {!minimal && (
            <>
              <button onClick={() => setZoom(100)} className="rounded-md px-2 py-1 text-xs text-slate-300 hover:bg-white/10">
                Fit page
              </button>
              <button onClick={() => setZoom(125)} className="rounded-md px-2 py-1 text-xs text-slate-300 hover:bg-white/10">
                Fit width
              </button>
              <span className="mx-1 h-4 w-px bg-white/20" />
              <button onClick={() => setZoom((z) => Math.max(50, z - 10))} className="rounded-md px-2 py-1 text-xs hover:bg-white/10">
                −
              </button>
              <span className="w-10 text-center text-xs font-semibold">{zoom}%</span>
              <button onClick={() => setZoom((z) => Math.min(200, z + 10))} className="rounded-md px-2 py-1 text-xs hover:bg-white/10">
                +
              </button>
              <span className="mx-1 h-4 w-px bg-white/20" />
            </>
          )}
          <button onClick={() => window.print()} className="flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium hover:bg-white/10">
            🖨 Print
          </button>
          {!minimal && (
            <button onClick={() => window.print()} className="flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium hover:bg-white/10">
              ⬇ Download
            </button>
          )}
          {onClose && (
            <>
              <span className="mx-1 h-4 w-px bg-white/20" />
              <button onClick={onClose} className="flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium hover:bg-white/10">
                ✕ Close
              </button>
            </>
          )}
        </div>
      </div>
      <div className="bg-slate-100 p-6 print:bg-white print:p-0">
        <div
          className="report-zoom-box mx-auto max-w-[900px] origin-top bg-white p-8 shadow print:max-w-none print:p-0 print:shadow-none"
          style={{ transform: `scale(${zoom / 100})` }}
        >
          {hotel && (
            <div className="mb-5 border-b border-slate-200 pb-3">
              <p className="text-lg font-bold text-brand-700">{hotel.name}</p>
              {addressParts.length > 0 && <p className="text-xs text-slate-500">{addressParts.join(', ')}</p>}
              {hotel.contactMobile && <p className="text-xs text-slate-500">☎ {hotel.contactMobile}</p>}
            </div>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}
