import { Logger } from '@nestjs/common';
import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import type {
  OtaAdapter,
  OtaBookingPayload,
  OtaPushCell,
  OtaPushResult,
  OtaRemoteProduct,
  OtaValidationResult,
} from './ota-adapter.interface.js';

const ENDPOINT = 'https://supply.agoda.com/api';

// Agoda YCS5 Supply API "type" codes — sourced against developer.agoda.com's
// own docs (see direct-ota-integration-guide.md §4.2), not guessed. Each
// number selects a different operation on the one generic endpoint.
const TYPE_GET_PRODUCT = '5';
const TYPE_SET_ARI_V2 = '10';
const TYPE_GET_BOOKING_LIST_V2 = '9';
const TYPE_GET_BOOKING_DETAIL = '4';

const builder = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: '@_', format: false });
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

/**
 * Real adapter for Agoda's Supply API (YCS5) — the first one built against
 * an actual public spec, per direct-ota-integration-guide.md's own suggested
 * order ("Agoda: best-documented, build this first").
 *
 * Two known gaps, deliberately not papered over:
 *  - `pushRates`' OtaPushCell has no extra-adult/child-price fields yet
 *    (ota-sync.service.ts's handlePush never reads them off InventoryRate),
 *    so <extra_bed>/<child_rates> are omitted rather than faked.
 *  - `fullSync` only proves the connection is alive (GetProduct) — a true
 *    "re-push the whole 730-day horizon" needs handleFullSync itself
 *    restructured to gather every InventoryRate row for the hotel first;
 *    that's separate follow-up work, not something this adapter can do
 *    with the {credentials, hotelId} it's currently given.
 */
export class AgodaAdapter implements OtaAdapter {
  private readonly logger = new Logger('AgodaAdapter');

  constructor(
    private readonly apiKey: string,
    private readonly onApiCall?: (log: { endpoint: string; requestBody: string; responseBody: string; httpStatus: number; latencyMs: number; errorMessage?: string }) => void,
  ) {}

  private async call(type: string, criteriaXml: Record<string, unknown>): Promise<{ ok: boolean; result: any; raw: string; status: number }> {
    const requestXml = builder.build({
      request: {
        '@_timestamp': Date.now().toString(),
        '@_type': type,
        ...criteriaXml,
      },
    });
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n${requestXml}`;
    const url = `${ENDPOINT}?apiKey=${encodeURIComponent(this.apiKey)}`;
    const started = Date.now();
    let status = 0;
    let raw = '';
    let errorMessage: string | undefined;
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/xml' }, body });
      status = res.status;
      raw = await res.text();
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
    }
    const latencyMs = Date.now() - started;
    this.onApiCall?.({ endpoint: url, requestBody: body, responseBody: raw, httpStatus: status, latencyMs, errorMessage });

    if (errorMessage) return { ok: false, result: null, raw: '', status: 0 };
    const result = parser.parse(raw)?.result;
    const ok = status >= 200 && status < 300 && !result?.errors;
    return { ok, result, raw, status };
  }

  async validateCredentials(credentials: Record<string, string>): Promise<OtaValidationResult> {
    const propertyId = credentials.propertyId;
    if (!propertyId) return { valid: false, message: 'Agoda Property ID is required' };
    const { ok, result } = await this.call(TYPE_GET_PRODUCT, { criteria: { property: { '@_id': propertyId } } });
    if (!ok) {
      const desc = result?.errors?.property?.error?.['@_description'];
      return { valid: false, message: desc ?? 'Could not verify this Property ID with Agoda' };
    }
    return { valid: true, message: `Verified: ${result?.property?.['@_name'] ?? propertyId}` };
  }

  async fetchRemoteProducts(credentials: Record<string, string>): Promise<OtaRemoteProduct[]> {
    const propertyId = credentials.propertyId;
    if (!propertyId) return [];
    const { ok, result } = await this.call(TYPE_GET_PRODUCT, { criteria: { property: { '@_id': propertyId } } });
    if (!ok) return [];

    const property = result?.property;
    const rooms = asArray(property?.rooms?.room);
    const ratePlans = asArray(property?.rateplans?.rateplan);
    const products = asArray(property?.products?.product);

    const roomById = new Map(rooms.map((r: any) => [r['@_room_id'], r['@_room_name']]));
    const ratePlanById = new Map(ratePlans.map((r: any) => [r['@_rateplan_id'], r['@_rateplan_name']]));

    return products
      .map((p: any) => ({
        roomCode: String(p['@_room_id']),
        roomName: String(roomById.get(p['@_room_id']) ?? p['@_room_id']),
        ratePlanCode: String(p['@_rateplan_id']),
        ratePlanName: String(ratePlanById.get(p['@_rateplan_id']) ?? p['@_rateplan_id']),
      }))
      .filter((p) => p.roomCode && p.ratePlanCode);
  }

  async pushRates(input: {
    credentials: Record<string, string> | null;
    otaRoomCode: string | null;
    otaRatePlanCode: string | null;
    cells: OtaPushCell[];
  }): Promise<OtaPushResult> {
    const propertyId = input.credentials?.propertyId;
    if (!propertyId) return { success: false, message: 'Agoda Property ID not set — add it on the Credentials page' };
    if (!input.otaRoomCode || !input.otaRatePlanCode) {
      return { success: false, message: 'This room is mapped by name only — pick it from the Agoda room list on the mapping wizard so we have its real room/rate-plan code' };
    }
    if (input.cells.length === 0) return { success: true, message: 'nothing to push' };

    const inventoryUpdates = input.cells.map((c) => ({
      '@_room_id': input.otaRoomCode,
      date_values: { value: c.date },
      allotment: c.availability,
    }));
    // Basic mode (§4.2): same price for every occupancy tier we were given.
    const rateUpdates = input.cells.map((c) => ({
      '@_room_id': input.otaRoomCode,
      '@_rateplan_id': input.otaRatePlanCode,
      date_values: { value: c.date },
      prices: { '@_currency': 'INR', normal: { '@_default': c.price } },
    }));

    const { ok, result } = await this.call(TYPE_SET_ARI_V2, {
      criteria: {
        '@_property_id': propertyId,
        inventory: { update: inventoryUpdates },
        rate: { update: rateUpdates },
      },
    });
    if (!ok) {
      const err = firstError(result);
      return { success: false, message: err ?? 'Agoda rejected this ARI push' };
    }
    return { success: true };
  }

  async fullSync(input: { credentials: Record<string, string> | null; hotelId: string }): Promise<OtaPushResult> {
    const propertyId = input.credentials?.propertyId;
    if (!propertyId) return { success: false, message: 'Agoda Property ID not set — add it on the Credentials page' };
    const validation = await this.validateCredentials(input.credentials!);
    if (!validation.valid) return { success: false, message: validation.message };
    this.logger.log(`Full Sync for Agoda property ${propertyId}: connection verified — per-cell ARI already reflects the latest Bulk Update/Dynamic Pricing writes.`);
    return { success: true, message: 'Connection verified with Agoda' };
  }

  async pollBookings(credentials: Record<string, string>): Promise<OtaBookingPayload[]> {
    const propertyId = credentials.propertyId;
    if (!propertyId) return [];

    const to = new Date();
    const from = new Date(to.getTime() - 55 * 60 * 1000); // just under Agoda's 60-min window cap
    const { ok, result } = await this.call(TYPE_GET_BOOKING_LIST_V2, {
      criteria: {
        '@_from': from.toISOString(),
        '@_to': to.toISOString(),
        property: { '@_id': propertyId },
      },
    });
    if (!ok) return [];

    const bookingsShort = asArray(result?.properties?.property?.bookings?.booking);
    const payloads: OtaBookingPayload[] = [];
    for (const b of bookingsShort) {
      const bookingId = String(b['@_booking_id']);
      const detail = await this.call(TYPE_GET_BOOKING_DETAIL, {
        criteria: { '@_language': 'EN', property: { '@_id': propertyId, booking: { '@_id': bookingId } } },
      });
      const booking = detail.result?.bookings?.booking;
      if (!booking) continue;
      const customer = booking.customer ?? {};
      const status: OtaBookingPayload['status'] = String(booking['@_status']).toLowerCase().includes('cancel') ? 'cancelled' : 'confirmed';
      payloads.push({
        otaBookingRef: bookingId,
        guestName: [customer['@_first_name'], customer['@_last_name']].filter(Boolean).join(' ') || 'Agoda Guest',
        otaRoomCode: String(booking['@_room_id'] ?? ''),
        checkIn: String(booking['@_arrival']),
        checkOut: String(booking['@_departure']),
        totalAmount: Number(booking.prices?.['@_sell_inclusive_amt'] ?? 0),
        status,
      });
    }
    return payloads;
  }
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function firstError(result: any): string | undefined {
  const err = result?.errors?.property?.error;
  if (!err) return undefined;
  const single = Array.isArray(err) ? err[0] : err;
  return single?.['@_description'];
}
