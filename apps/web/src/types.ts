export interface ActingUser {
  userId: string;
  organizationId: string;
  hotelId: string | null;
  roles: Record<string, string>;
}

export interface Hotel {
  id: string;
  name: string;
  city: string | null;
  shortCode: string;
  expectedRoomCount: number | null;
  expectedStaffCount: number | null;
}

export interface RoomCategory {
  id: string;
  hotelId: string;
  name: string;
}

export interface Room {
  id: string;
  hotelId: string;
  roomCategoryId: string | null;
  roomNumber: string;
  status: 'available' | 'occupied' | 'housekeeping';
  currentStayId: string | null;
  roomCategory: RoomCategory | null;
  currentStay: Booking | null;
}

export type IdType = 'aadhaar' | 'passport' | 'driving_license' | 'voter_id' | 'other';
export type Gender = 'male' | 'female' | 'other' | 'prefer_not_to_say';

export interface Guest {
  id: string;
  hotelId: string;
  title: string | null;
  name: string;
  phone: string;
  email: string | null;
  gender: Gender | null;
  dateOfBirth: string | null;
  address: string | null;
  country: string | null;
  state: string | null;
  city: string | null;
  pincode: string | null;
  idType: IdType | null;
  idNumber: string | null;
  idPhotoPath: string | null;
}

export interface Booking {
  id: string;
  hotelId: string;
  guestName: string;
  guestPhone: string | null;
  guestId: string | null;
  purposeOfStay: string | null;
  idType: IdType | null;
  idNumber: string | null;
  roomCategoryId: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  status: 'confirmed' | 'checked_in' | 'checked_out' | 'cancelled';
  source: string;
  paidAmount: string | null;
  totalAmount: string;
  delayResolvedAt: string | null;
  delayResolvedNote: string | null;
  payments?: Payment[];
}

export interface InHouseRow {
  room: { id: string; roomNumber: string; roomCategory: RoomCategory | null };
  booking: Booking;
  delayed: boolean;
  cleaningDeadline: string;
}

export interface StaffMember {
  id: string;
  name: string;
  role: 'owner' | 'manager' | 'front_desk' | 'housekeeping' | null;
  createdAt: string;
}

export interface HousekeeperStat {
  id: string;
  name: string;
  cleaningsToday: number;
  cleaningsTotal: number;
  lastCleaningAt: string | null;
  lastRoomNumber: string | null;
  lastFlagged: boolean;
}

export interface RoomsReportDay {
  date: string;
  checkIns: number;
  cleanings: number;
  guestCleanings: number;
  checkouts: number;
  discrepancies: number;
  delaysResolved: number;
  cash: number;
  online: number;
  card: number;
}

export interface RoomsReportRoomRow {
  roomId: string;
  roomNumber: string;
  checkIns: number;
  cleanings: number;
  discrepancies: number;
}

export interface RoomsReport {
  days: RoomsReportDay[];
  rooms: RoomsReportRoomRow[];
}

export interface SaleReportDay {
  date: string;
  cash: number;
  online: number;
  card: number;
  due: number;
  totalSale: number;
  bookings: { id: string; guestName: string; roomNumber: string | null; totalAmount: number; paidAmount: number; due: number }[];
}

export interface Payment {
  id: string;
  amount: string;
  method: 'cash' | 'online' | 'card';
  collectedAt: string;
}

export interface RatePlan {
  id: string;
  roomCategoryId: string;
  name: string;
  mealPlan: string | null;
}

export interface OtaConnection {
  id: string;
  hotelId: string;
  otaCode: string;
  status: string;
}

export interface InventoryRate {
  id: string;
  date: string;
  occupancyTier: number;
  price: string;
  availability: number;
  source: 'bulk_update' | 'value_override' | 'ota_push';
  gst: { rate: number; itcEligible: boolean; label: string };
}

export interface Restriction {
  id: string;
  date: string;
  channelBlocked: boolean;
  ratePlanClosed: boolean;
  minLos: number | null;
}

export interface CleaningRecord {
  id: string;
  roomId: string;
  kind: 'checkout' | 'guest_stay';
  photos: string[];
  flagged: boolean;
  resolvedAt: string | null;
  resolvedNote: string | null;
  createdAt: string;
}
