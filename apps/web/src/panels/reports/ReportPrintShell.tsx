import { useEffect, useState } from 'react';
import { query } from '../../api';
import { useAuth } from '../../AuthContext';
import type { Hotel } from '../../types';

/**
 * §user request, with a reference app's own Police Report / Day Wise Booking Report / Check-In
 * and Check-Out Report as the target — these generate straight into a printable document instead
 * of staying an on-screen table, the same way InvoicePrintView already does for a single booking's
 * invoice: the browser's own print dialog (`window.print()`, "Save as PDF" covers "download"),
 * isolated on the page via `.report-print-root`/`.no-print` in index.css. Zoom is a plain CSS
 * `zoom` (Chrome/Edge/Safari only, same family of browsers Fit page/Fit width belongs to).
 */
export function ReportPrintShell({ hotelId, title, children }: { hotelId: string; title: string; children: React.ReactNode }) {
  const { token } = useAuth();
  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [zoom, setZoom] = useState(100);

  useEffect(() => {
    query<Hotel>('hotels.get', { hotelId }, token ?? undefined).then(setHotel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId]);

  const addressParts = hotel ? [hotel.addressLine, hotel.city, hotel.state, hotel.pincode].filter(Boolean) : [];

  return (
    <div className="report-print-root overflow-hidden rounded-xl border border-slate-700 shadow-sm">
      <div className="no-print flex flex-wrap items-center justify-between gap-2 bg-slate-800 px-4 py-2.5 text-sm text-white">
        <span className="font-semibold">{title}</span>
        <div className="flex items-center gap-1.5">
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
          <button onClick={() => window.print()} className="flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium hover:bg-white/10">
            🖨 Print
          </button>
          <button onClick={() => window.print()} className="flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium hover:bg-white/10">
            ⬇ Download
          </button>
        </div>
      </div>
      <div className="max-h-[75vh] overflow-auto bg-slate-100 p-6 print:max-h-none print:overflow-visible print:bg-white print:p-0">
        <div className="mx-auto bg-white p-8 shadow print:w-full print:shadow-none" style={{ width: `${zoom}%`, maxWidth: zoom <= 100 ? '900px' : 'none' }}>
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
