import type { BookingSource } from './types';

// Mirrors apps/api/prisma/schema.prisma's BookingSource enum exactly. Shared between
// CreateReservationModal and CheckInModal (both default to 'walk_in') so both forms offer the
// identical option set instead of two copies drifting apart.
// §user request — "Direct aur Walk-in dono same baat hai, Walk-in rakho, Direct hata do": 'direct'
// stays a valid value in the backend enum (so any booking already tagged 'direct' before this
// change keeps displaying correctly everywhere — SOURCE_LABEL/CHANNEL_META still know it), it's
// just no longer offered as a choice here — every new non-OTA booking is 'walk_in' from now on.
export const BOOKING_SOURCE_OPTIONS: { value: BookingSource; label: string }[] = [
  { value: 'walk_in', label: 'Walk-in' },
  { value: 'booking_com', label: 'Booking.com' },
  { value: 'mmt_goibibo', label: 'MakeMyTrip / Goibibo' },
  { value: 'agoda', label: 'Agoda' },
  { value: 'airbnb', label: 'Airbnb' },
  { value: 'expedia', label: 'Expedia' },
  { value: 'cleartrip', label: 'Cleartrip' },
  { value: 'easemytrip', label: 'EaseMyTrip' },
  { value: 'yatra', label: 'Yatra' },
];
