/**
 * What each OTA actually asks a hotel for — researched against the engineering
 * team's own direct-ota-integration-guide.md (26 Sep 2026), which cites each
 * OTA's public developer docs directly. Replaces an earlier generic
 * username/password/API-key form that didn't match any real OTA's onboarding.
 * Stored as a flat Record<string,string> in the same encrypted vault
 * (credential-vault.service.ts) regardless of which OTA it's for — no
 * backend schema change needed, only these field definitions differ per OTA.
 */
export interface CredentialField {
  key: string;
  label: string;
  placeholder?: string;
  type?: 'text' | 'password';
}

export const OTA_CREDENTIAL_FIELDS: Record<string, CredentialField[]> = {
  // Direct integration (spec still 🔒 pending MMT's response after BD approval)
  // — hotel enables us in InGo-MMT Connect > Settings > Channel Manager, which
  // generates these two against the hotel code.
  mmt_goibibo: [
    { key: 'hotelCode', label: 'MMT Hotel Code' },
    { key: 'accessToken', label: 'Access Token', type: 'password' },
  ],
  // Direct integration via Agoda's Supply API (YCS5) — real adapter wired in.
  // Only the property ID is per-hotel; the API key itself is a platform-level
  // credential we hold once, not something each hotel provides (see note).
  agoda: [{ key: 'propertyId', label: 'Agoda Property ID' }],
  // No direct hotel applications accepted — access only exists through an
  // already-certified Connectivity Partner. These fields are for reference
  // only; there is no "apply here" path for an individual property.
  booking_com: [
    { key: 'propertyId', label: 'Booking.com Property ID' },
    { key: 'connectivityPartnerNote', label: 'Certified connectivity partner your property currently uses (if any)' },
  ],
  // Hotel picks its channel manager from a dropdown in Partner Central;
  // Hotel ID lives under property settings there.
  expedia: [{ key: 'hotelId', label: 'Expedia Hotel ID' }],
  // Airbnb's Partner (Homes) API is invite-only — Airbnb approaches
  // enterprise partners itself and isn't accepting new applications. These
  // fields are for whenever/if that access exists, not a normal signup flow.
  airbnb: [{ key: 'listingId', label: 'Airbnb Listing/Property ID (only if Airbnb has already granted you API access)' }],
  // EaseMyTrip's own property sign-up form already has a channel-manager
  // dropdown — we just need to be added to it. Fields are 🔒 pending their spec.
  easemytrip: [{ key: 'propertyId', label: 'EaseMyTrip Property ID (pending their spec)' }],
  // No public developer docs — real-world access is mediated through their
  // hotel supply/partnerships team. Fields are 🔒 pending their spec.
  cleartrip: [{ key: 'hotelId', label: 'Cleartrip Hotel ID (pending their spec)' }],
  // Direct is possible: hotel registers on Yatra, we submit an activation
  // request, Yatra enables in a few days and emails connection details.
  yatra: [{ key: 'hotelId', label: 'Yatra Hotel ID (pending activation)' }],
};

/** Shown above the fields — the honest access-model context per OTA. */
export const OTA_ACCESS_NOTE: Record<string, string> = {
  mmt_goibibo: 'Direct integration — no public spec yet. Hotels request us via their MMT BDM to get added to the extranet\'s channel-manager dropdown; MMT then sends us the API spec, sandbox and this hotel\'s Hotel Code + Access Token.',
  agoda: 'Direct integration via Agoda\'s Supply API — live in this system. We hold one partner-level API key platform-wide; once you give us this property\'s Agoda Property ID, we request Agoda to authorize it for our key (agoda.chain.support@agoda.com), usually 1–3 business days.',
  booking_com: 'Not directly available to individual properties. Booking.com only grants API access to already-certified Connectivity Partners — a hotel connects by choosing one of those on its own Booking.com extranet, not through credentials entered here.',
  expedia: 'Requires our own PCI compliance review + licence agreement with Expedia first (connectivitypartner@expediagroup.com) — then a hotel selects us as its channel manager inside Expedia Partner Central\'s own Connectivity Settings.',
  airbnb: 'Airbnb\'s API is invite-only for enterprise software partners — it is not currently possible to apply for access as an individual hotel or a new channel manager.',
  easemytrip: 'Their property sign-up form already lists channel managers in a dropdown — we need EaseMyTrip\'s supply/partner team to add us to it, then send the technical spec.',
  cleartrip: 'No public partner program — real-world access goes through Cleartrip\'s hotel supply/partnerships team, who would send the technical spec once engaged.',
  yatra: 'Direct is possible: register this property on Yatra, then we submit a CM activation request — Yatra typically enables it within a few days and emails the connection details.',
};
