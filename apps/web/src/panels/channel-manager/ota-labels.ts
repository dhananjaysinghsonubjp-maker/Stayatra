export const OTA_CODES = ['mmt_goibibo', 'booking_com', 'agoda', 'cleartrip', 'expedia', 'airbnb', 'easemytrip', 'yatra'];

export const OTA_LABEL: Record<string, string> = {
  mmt_goibibo: 'MakeMyTrip / Goibibo',
  booking_com: 'Booking.com',
  agoda: 'Agoda',
  cleartrip: 'Cleartrip',
  expedia: 'Expedia',
  airbnb: 'Airbnb',
  easemytrip: 'EaseMyTrip',
  yatra: 'Yatra',
};

/** Every booking source, OTA or not — the one shared label map for anywhere a booking's source is shown. */
export const SOURCE_LABEL: Record<string, string> = { direct: 'Direct', walk_in: 'Walk-in', ...OTA_LABEL };

/**
 * No official OTA logo files are bundled with the app (and we don't fetch brand marks from
 * arbitrary URLs), so every channel gets a small monogram badge instead — its own color, a short
 * initial, consistent everywhere a channel needs a "logo": the Calendar's booking bars, the
 * bookings table, anywhere else. Swap in real SVG logos here later if licensed ones are sourced.
 */
export const CHANNEL_META: Record<string, { letter: string; bg: string; text: string }> = {
  direct: { letter: 'D', bg: 'bg-slate-600', text: 'text-white' },
  walk_in: { letter: 'W', bg: 'bg-amber-500', text: 'text-white' },
  mmt_goibibo: { letter: 'M', bg: 'bg-orange-500', text: 'text-white' },
  booking_com: { letter: 'B', bg: 'bg-blue-600', text: 'text-white' },
  agoda: { letter: 'A', bg: 'bg-red-500', text: 'text-white' },
  expedia: { letter: 'E', bg: 'bg-yellow-500', text: 'text-white' },
  airbnb: { letter: 'Ab', bg: 'bg-rose-500', text: 'text-white' },
  cleartrip: { letter: 'C', bg: 'bg-teal-500', text: 'text-white' },
  easemytrip: { letter: 'Em', bg: 'bg-cyan-600', text: 'text-white' },
  yatra: { letter: 'Y', bg: 'bg-indigo-600', text: 'text-white' },
};
