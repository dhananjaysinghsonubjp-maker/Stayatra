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
  /** Only present on bookings.getRoomBoard's response — past its cleaning deadline (§8.7), not on other room-listing endpoints. */
  delayed?: boolean;
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

export interface InvoiceLineItem {
  id: string;
  bookingId: string;
  description: string;
  quantity: number;
  unitPrice: string;
  amount: string;
  createdAt: string;
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
  assignedRoomId: string | null;
  checkIn: string;
  checkOut: string;
  nights: number;
  status: 'confirmed' | 'checked_in' | 'checked_out' | 'cancelled';
  source: string;
  paidAmount: string | null;
  totalAmount: string;
  discountAmount: string | null;
  gstExempt: boolean;
  delayResolvedAt: string | null;
  delayResolvedNote: string | null;
  /** Set the moment status becomes checked_in — basis for the 1-hour post-check-in edit window. */
  checkedInAt: string | null;
  createdAt: string;
  payments?: Payment[];
  lineItems?: InvoiceLineItem[];
}

export interface DueRow {
  booking: Booking;
  roomNumber: string | null;
  grandTotal: number;
  due: number;
}

export interface InvoiceTotals {
  basePrice: number;
  extraCharges: number;
  subtotal: number;
  discount: number;
  gst: { rate: number; label: string; amount: number };
  grandTotal: number;
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

export type PaymentMethod =
  | 'cash'
  | 'online'
  | 'card'
  | 'bank_transfer'
  | 'company_settlement'
  | 'agent_settlement'
  | 'upi'
  | 'credit_sale'
  | 'cheque'
  | 'cash_deposit';

export type MethodBreakdown = Partial<Record<PaymentMethod, number>>;

export interface RoomsReportDay {
  date: string;
  checkIns: number;
  cleanings: number;
  guestCleanings: number;
  checkouts: number;
  discrepancies: number;
  delaysResolved: number;
  methods: MethodBreakdown;
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
  methods: MethodBreakdown;
  due: number;
  totalSale: number;
  bookings: { id: string; guestName: string; roomNumber: string | null; grandTotal: number; paidAmount: number; due: number }[];
}

export interface Payment {
  id: string;
  amount: string;
  method: PaymentMethod;
  referenceNumber: string | null;
  receiptPhotoPath: string | null;
  collectedAt: string;
}

/** A co-occupant sharing a booking's room/stay — "add another guest," not a separate booking. */
export interface BookingGuest {
  id: string;
  bookingId: string;
  title: string | null;
  name: string;
  phone: string | null;
  idType: IdType | null;
  idNumber: string | null;
  createdAt: string;
}

export interface RatePlan {
  id: string;
  roomCategoryId: string;
  name: string;
  mealPlan: string | null;
  isDerived: boolean;
  baseRatePlanId: string | null;
  formula: string | null;
  /** Only present on rates.listAllRatePlansForHotel's response (Rate/Inventory Update's hotel-wide row list). */
  roomCategoryName?: string;
}

export interface OtaConnection {
  id: string;
  hotelId: string;
  otaCode: string;
  status: string;
  commissionRatePercent: string | null;
}

export interface InventoryRate {
  id: string;
  date: string;
  occupancyTier: number;
  price: string;
  extraAdultPrice: string | null;
  child1Price: string | null;
  child2Price: string | null;
  availability: number;
  source: 'bulk_update' | 'value_override' | 'ota_push';
  gst: { rate: number; itcEligible: boolean; label: string };
}

export interface Restriction {
  id: string;
  date: string;
  channelBlocked: boolean;
  ratePlanClosed: boolean;
  closedToArrival: boolean;
  closedToDeparture: boolean;
  minLos: number | null;
  maxLos: number | null;
  bookableNights: number | null;
  minAdvanceDays: number | null;
  maxAdvanceDays: number | null;
  policyOverrideId: string | null;
  minLosArrival: number | null;
  maxLosArrival: number | null;
  exactLosArrival: number | null;
  cap: number | null;
  cutoffHours: number | null;
  allocationCount: number | null;
}

export interface OtaRoomMapping {
  id: string;
  otaConnectionId: string;
  roomCategoryId: string;
  otaRoomName: string;
  otaRoomCode: string | null;
  otaRatePlanCode: string | null;
}

/** What a real adapter's fetchRemoteProducts returns — empty for stub-only OTAs. */
export interface OtaRemoteProduct {
  roomCode: string;
  roomName: string;
  ratePlanCode: string;
  ratePlanName: string;
}

export interface Notification {
  id: string;
  hotelId: string;
  type: 'sync_failed' | 'booking_created' | 'booking_cancelled';
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  createdAt: string;
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
