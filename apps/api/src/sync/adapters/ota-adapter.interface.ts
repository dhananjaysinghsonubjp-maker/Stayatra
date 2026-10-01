export interface OtaPushCell {
  date: string; // YYYY-MM-DD
  occupancyTier: number;
  price: number;
  availability: number;
}

export interface OtaPushResult {
  success: boolean;
  message?: string;
}

export interface OtaValidationResult {
  valid: boolean;
  message?: string;
}

// What the mapping UI shows to pick from, once a real adapter can fetch it —
// stub-only OTAs (no public API yet) return none, so the wizard falls back
// to free-text entry (ChannelMappingWizard.tsx).
export interface OtaRemoteProduct {
  roomCode: string;
  roomName: string;
  ratePlanCode: string;
  ratePlanName: string;
}

// A booking as pulled from the OTA, before it becomes one of our own Booking
// rows — deliberately minimal and adapter-agnostic; OtaSyncService does the
// idempotent create (keyed on otaConnectionId + otaBookingRef) and normalizes
// occupancy tier -> BookingSource etc.
export interface OtaBookingPayload {
  otaBookingRef: string;
  guestName: string;
  guestPhone?: string;
  otaRoomCode: string;
  checkIn: string; // YYYY-MM-DD
  checkOut: string; // YYYY-MM-DD
  totalAmount: number;
  status: 'confirmed' | 'cancelled';
}

// One adapter per OTA, behind this interface — §1's "one codebase, no forks"
// principle applied to integrations: the sync service and job queue never
// know which OTA they're talking to, just that they implement OtaAdapter.
// `credentials` is always the decrypted per-hotel vault contents (never a
// raw credentialRef string — only OtaSyncService ever touches the vault
// itself, per credential-vault.service.ts's own access-control comment).
export interface OtaAdapter {
  pushRates(input: {
    credentials: Record<string, string> | null;
    otaRoomCode: string | null;
    otaRatePlanCode: string | null;
    otaRoomName: string | null;
    cells: OtaPushCell[];
  }): Promise<OtaPushResult>;

  fullSync(input: { credentials: Record<string, string> | null; hotelId: string }): Promise<OtaPushResult>;

  /** "Test connection" (direct-ota-integration-guide.md §3 step 5) — a cheap read-only call proving the credentials actually work. Optional: stub-only OTAs have nothing to validate against. */
  validateCredentials?(credentials: Record<string, string>): Promise<OtaValidationResult>;

  /** Feeds the mapping wizard's code-based picker once a real adapter exists (§3 step 6). */
  fetchRemoteProducts?(credentials: Record<string, string>): Promise<OtaRemoteProduct[]>;

  /** Manual "Poll bookings now" escape hatch, mirroring Full Sync's pattern — a real recurring poller is later work (§2.3's "full refresh job" applies to ARI, not bookings, which need their own cadence). */
  pollBookings?(credentials: Record<string, string>): Promise<OtaBookingPayload[]>;
}
