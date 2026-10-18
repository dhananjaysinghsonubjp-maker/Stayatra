/**
 * DD/MM/YY (§ user request) — the one date format used across every Bookings/Reservations
 * screen (Dashboard's recent-bookings table, Reservations list, Booking Details modal, Business
 * Reports' bookings table). Scoped to this module deliberately, not applied app-wide — other
 * screens (invoices/GST documents, audit log, cleaning records) keep their own format, since a
 * blanket app-wide change risked touching legal/financial displays that need their own precision.
 */
export function formatDateShort(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y.slice(2)}`;
}

/** Same DD/MM/YY date, plus a 12-hour time — for timestamps that need both (e.g. "Booking Date"). */
export function formatDateTimeShort(iso: string) {
  const d = new Date(iso);
  const date = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(2)}`;
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${date}, ${time}`;
}
