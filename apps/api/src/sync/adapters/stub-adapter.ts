import { Logger } from '@nestjs/common';
import type { OtaAdapter, OtaPushResult } from './ota-adapter.interface.js';

/**
 * Placeholder for every real OTA connector (§7 Phase 1 #7/#8). No partner API
 * access is secured yet for any channel (MMT+Goibibo is next in line — see
 * memory/hotel_platform_build_plan.md), so this simulates a push/sync
 * succeeding after a short delay, which proves the queue/retry/dead-letter
 * architecture end to end without real credentials.
 *
 * To wire in a real OTA: implement OtaAdapter against that OTA's actual API
 * (auth via `credentialRef` → the credential vault, §3) and register it in
 * OtaSyncService's adapter map instead of this stub, keyed by ota_code.
 */
export class StubOtaAdapter implements OtaAdapter {
  private readonly logger = new Logger('StubOtaAdapter');

  async pushRates(input: { credentialRef: string | null; otaRoomName: string | null; cells: unknown[] }): Promise<OtaPushResult> {
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
