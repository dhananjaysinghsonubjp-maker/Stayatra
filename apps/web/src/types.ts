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

export interface Booking {
  id: string;
  hotelId: string;
  guestName: string;
  guestPhone: string | null;
  roomCategoryId: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  status: 'confirmed' | 'checked_in' | 'checked_out' | 'cancelled';
  source: string;
  paidAmount: string | null;
  totalAmount: string;
  payments?: Payment[];
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
