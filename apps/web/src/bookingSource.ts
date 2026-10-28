import type { BookingSource } from './types';

// Mirrors apps/api/prisma/schema.prisma's BookingSource enum exactly. Shared between
// CreateReservationModal (defaults to 'direct') and CheckInModal (defaults to 'walk_in') so both
// forms offer the identical option set instead of two copies drifting apart.
export const BOOKING_SOURCE_OPTIONS: { value: BookingSource; label: string }[] = [
  { value: 'direct', label: 'Direct' },
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
