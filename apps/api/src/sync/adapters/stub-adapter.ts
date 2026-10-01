import { Logger } from '@nestjs/common';
import type { OtaAdapter, OtaPushCell, OtaPushResult } from './ota-adapter.interface.js';

/**
 * Placeholder for every OTA with no real adapter wired in yet (§7 Phase 1
 * #7/#8 — direct-ota-integration-guide.md's five channels still pending
 * their partner agreement/spec: MMT+Goibibo, EaseMyTrip, Cleartrip, Yatra,
 * Expedia). Simulates a push/sync succeeding after a short delay, which
 * proves the queue/retry/dead-letter architecture end to end without real
 * credentials.
 *
 * To wire in a real OTA: implement OtaAdapter against that OTA's actual API
 * and register it in OtaSyncService's adapter map instead of this stub, keyed
 * by ota_code — see agoda-adapter.ts for the first one built this way.
 */
export class StubOtaAdapter implements OtaAdapter {
  private readonly logger = new Logger('StubOtaAdapter');

  async pushRates(input: { otaRoomName: string | null; cells: OtaPushCell[] }): Promise<OtaPushResult> {
    this.logger.log(`[SIMULATED] pushRates: ${input.cells.length} cell(s) -> room "${input.otaRoomName ?? 'unmapped'}"`);
    await delay(200);
    return { success: true, message: 'simulated push' };
  }

  async fullSync(input: { hotelId: string }): Promise<OtaPushResult> {
    this.logger.log(`[SIMULATED] fullSync for hotel ${input.hotelId}`);
    await delay(400);
    return { success: true, message: 'simulated full sync' };
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
