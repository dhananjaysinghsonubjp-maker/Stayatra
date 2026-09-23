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

// One adapter per OTA, behind this interface — §1's "one codebase, no forks"
// principle applied to integrations: the sync service and job queue never
// know which OTA they're talking to, just that they implement OtaAdapter.
export interface OtaAdapter {
  pushRates(input: { credentialRef: string | null; otaRoomName: string | null; cells: OtaPushCell[] }): Promise<OtaPushResult>;
  fullSync(input: { credentialRef: string | null; hotelId: string }): Promise<OtaPushResult>;
}
