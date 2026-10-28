export interface ActingUser {
  userId: string;
  organizationId: string;
  hotelId: string | null;
  roles: Record<string, string>;
}

export interface Hotel {
  id: string;
  name: string;
  addressLine?: string | null;
  apartmentOrFloor?: string | null;
  city: string | null;
  state?: string | null;
  pincode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  shortCode: string;
  expectedRoomCount: number | null;
  expectedStaffCount: number | null;
  starRating?: number | null;
  builtYear?: number | null;
  acceptingBookingsSince?: number | null;
  contactEmail?: string | null;
  contactMobile?: string | null;
  contactMobileIsWhatsapp?: boolean;
  contactLandline?: string | null;
  checkInTime?: string | null;
  checkOutTime?: string | null;
  cancellationPolicy?: 'free_till_checkin' | 'free_24h' | 'free_48h' | 'free_72h' | 'non_refundable' | null;
  allowUnmarriedCouples?: boolean | null;
  amenities?: string[];
  gstRegistration?: string | null;
  panNumber?: string | null;
  bankAccountHolderName?: string | null;
  bankAccountNumber?: string | null;
  bankIfsc?: string | null;
  logoFilePath?: string | null;
  brandColor?: string | null;
  bannerText?: string | null;
  fontFamily?: string | null;
  licenseNumber?: string | null;
  upiId?: string | null;
  invoiceTerms?: string | null;
  invoiceStampPath?: string | null;
  showPaymentSummaryOnInvoice?: boolean;
  showTermsOnInvoice?: boolean;
}

export interface HotelPhoto {
  id: string;
  hotelId: string;
  filePath: string;
  sortOrder: number;
  createdAt: string;
}

export interface RoomCategory {
  id: string;
  hotelId: string;
  name: string;
  description: string | null;
  active: boolean;
  roomType: string | null;
  roomView: string | null;
  roomSizeSqft: number | null;
  bedType: string | null;
  maxOccupancy: number | null;
  bathroomCount: number | null;
  amenities: string[];
}

export interface RoomPhoto {
  id: string;
  roomCategoryId: string;
  filePath: string;
  sortOrder: number;
  createdAt: string;
}

export interface RoomCategoryDetail extends RoomCategory {
  roomCount: number;
  photos: RoomPhoto[];
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
  idPhotoBackPath: string | null;
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

export type BookingSource =
  | 'direct'
  | 'walk_in'
  | 'booking_com'
  | 'mmt_goibibo'
  | 'agoda'
  | 'airbnb'
  | 'expedia'
  | 'cleartrip'
  | 'easemytrip'
  | 'yatra';

export interface Booking {
  id: string;
  hotelId: string;
  guestName: string;
  guestPhone: string | null;
  guestId: string | null;
  guestEmail: string | null;
  specialRequest: string | null;
  /** Groups several Booking rows (one per room) into one umbrella reservation — null for the
   * ordinary single-room case. */
  reservationGroupId: string | null;
  /** Who actually placed a multi-room reservation (e.g. a travel agent or corporate contact
   * booking several rooms on behalf of different guests) — set once at creation, distinct from
   * `guestName`, which becomes that specific room's actual occupant at its own check-in. Null
   * for an ordinary single-room booking, where the booker and the guest are the same person. */
  bookedByName: string | null;
  /** Same staleness reasoning as bookedByName, for the group's own contact number. */
  bookedByPhone: string | null;
  purposeOfStay: string | null;
  idType: IdType | null;
  idNumber: string | null;
  roomCategoryId: string;
  ratePlanId: string | null;
  assignedRoomId: string | null;
  checkIn: string;
  checkOut: string;
  nights: number;
  status: 'confirmed' | 'checked_in' | 'checked_out' | 'cancelled';
  source: BookingSource;
  paidAmount: string | null;
  paymentMethod?: string | null;
  totalAmount: string;
  discountAmount: string | null;
  gstExempt: boolean;
  delayResolvedAt: string | null;
  delayResolvedNote: string | null;
  /** Set the moment status becomes checked_in — basis for the 1-hour post-check-in edit window. */
  checkedInAt: string | null;
  /** Set by the FMO/GM's explicit Check-out Guest action — the room only becomes available after housekeeping cleans it. */
  checkedOutAt: string | null;
  checkedOutBy: string | null;
  createdAt: string;
  otaBookingRef: string | null;
  otaCancellationPolicy: string | null;
  /** The channel's own voucher/payout breakdown (commission, taxes, TCS/TDS, net payable…) — shape varies per channel, rendered generically. */
  channelBreakdown: Record<string, string | number> | null;
  /** §user request — set from the invoice print view, any time: switches the invoice's "Billed
   * to" from the individual guest to this company (for their GST input credit). Null = bill to
   * the guest, unchanged. */
  billToCompanyName: string | null;
  billToCompanyTaxIdType: string | null;
  billToCompanyGstin: string | null;
  billToCompanyPhone: string | null;
  billToCompanyEmail: string | null;
  billToCompanyAddress: string | null;
  billToCompanyCountry: string | null;
  billToCompanyState: string | null;
  billToCompanyCity: string | null;
  billToCompanyPincode: string | null;
  payments?: Payment[];
  lineItems?: InvoiceLineItem[];
  /** Co-occupants sharing this room (not separate bookings) — "Total Guests" is 1 (the primary
   * guest) plus this list's length. */
  guests?: BookingGuest[];
}

export interface Review {
  id: string;
  hotelId: string;
  bookingId: string;
  source: string;
  rating: string;
  maxRating: number;
  reviewText: string | null;
  reviewDate: string;
  createdBy: string;
  createdAt: string;
  booking: { guestName: string; guestPhone: string | null; checkIn: string; checkOut: string; nights: number };
}

export interface ReviewableBooking {
  id: string;
  guestName: string;
  source: string;
  checkIn: string;
  checkOut: string;
  status: string;
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

export type StaffApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface StaffProfile {
  id: string;
  name: string;
  role: 'owner' | 'manager' | 'front_desk' | 'housekeeping' | null;
  /** Job title shown in the UI (e.g. "General Manager" vs "Front Office Manager") — both carry
   * the same `front_desk` permission level, this is just which title the hotel picked. */
  designation: string | null;
  /** Housekeeping only — which shift they work (Morning/Evening/Night). */
  shift: string | null;
  phone: string | null;
  photoPath: string | null;
  idType: IdType | null;
  idNumber: string | null;
  /** §user request — Aadhaar front and back, uploaded separately, shown together on one
   * printable review page for the owner. */
  idPhotoFrontPath: string | null;
  idPhotoBackPath: string | null;
  approvalStatus: StaffApprovalStatus;
  approvalNote: string | null;
  hasPinSet: boolean;
  createdAt: string;
}

/** Self-only subset returned by `staff.myProfile` — what a non-owner can see of their own
 * record (no approval/Aadhar fields, which stay owner-side only). */
export interface MyStaffProfile {
  id: string;
  name: string;
  role: 'owner' | 'manager' | 'front_desk' | 'housekeeping' | null;
  designation: string | null;
  shift: string | null;
  phone: string | null;
  photoPath: string | null;
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

/** `rates.listActiveOverrides`' shape — a value-override cell plus just enough of its
 * parent rate plan/room category/channel to label it in a list, without a separate lookup. */
export interface ActiveOverrideRow {
  id: string;
  date: string;
  occupancyTier: number;
  price: string;
  availability: number;
  ratePlan: { id: string; name: string; roomCategory: { id: string; name: string } };
  otaConnection: { id: string; otaCode: string };
}

/** `rates.listActiveOverrides`' restriction half — same labeling shape as ActiveOverrideRow. */
export interface ActiveRestrictionRow extends Restriction {
  ratePlan: { id: string; name: string; roomCategory: { id: string; name: string } };
  otaConnection: { id: string; otaCode: string };
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
  type: 'sync_failed' | 'booking_created' | 'booking_cancelled' | 'staff_pending_approval' | 'room_auto_checked_out' | 'cleaning_discrepancy';
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
  primaryHousekeeperId: string;
  secondHousekeeperId: string | null;
  photos: string[];
  flagged: boolean;
  resolvedAt: string | null;
  resolvedNote: string | null;
  createdAt: string;
}

export interface HousekeeperOption {
  id: string;
  name: string;
  shift: string | null;
}

/** §user request — hotel's own address book of outside vendors (electrician, plumber, …). */
export interface HotelContact {
  id: string;
  hotelId: string;
  name: string;
  category: string;
  phone: string;
  createdAt: string;
}

export interface LedgerCategory {
  id: string;
  hotelId: string;
  name: string;
  parentId: string | null;
  createdAt: string;
}

/** The merged Ledger view — a real `LedgerEntry` row (kind 'ledger', deletable) or a guest
 * `Payment` surfaced read-only (kind 'payment', category always "Room"). */
export interface LedgerTransaction {
  id: string;
  kind: 'ledger' | 'payment';
  type: 'cash_in' | 'cash_out';
  amount: number;
  paymentMethod: PaymentMethod;
  category: string | null;
  remarks: string | null;
  isPettyCash: boolean;
  createdAt: string;
  bookingId: string | null;
  guestName: string | null;
}

export interface LedgerSummary {
  balance: number;
  cashIn: number;
  cashOut: number;
  byMode: Partial<Record<PaymentMethod, number>>;
  pettyCashBalance: number;
  opening: number;
}
