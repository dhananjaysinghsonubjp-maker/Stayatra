import { Injectable, Logger } from '@nestjs/common';
import type { ExtractedIdDetails, IdExtractor } from './id-extractor.interface.js';

/**
 * "AI Check-in" without a real ANTHROPIC_API_KEY configured (§ — added beyond
 * the MD spec at the user's request). Returns obviously-fake placeholder data
 * so the upload -> extract -> autofill pipeline is provable end to end without
 * incurring API cost or needing a key. Swap for AnthropicIdExtractor the
 * moment ANTHROPIC_API_KEY is set — see id-extraction.module.ts.
 */
@Injectable()
export class StubIdExtractor implements IdExtractor {
  private readonly logger = new Logger(StubIdExtractor.name);

  async extract(): Promise<ExtractedIdDetails> {
    this.logger.log('[SIMULATED] ID extraction — no ANTHROPIC_API_KEY configured, returning stub data');
    return {
      name: 'Sample Guest (stub — set ANTHROPIC_API_KEY for real extraction)',
      gender: 'other',
      dateOfBirth: '1990-01-01',
      address: '123 Sample Street',
      country: 'India',
      state: 'Sample State',
      city: 'Sample City',
      pincode: '000000',
      idType: 'aadhaar',
      idNumber: '0000-0000-0000',
      confidence: 'stub',
    };
  }
}
