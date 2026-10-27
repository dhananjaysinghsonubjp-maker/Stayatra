import { Module } from '@nestjs/common';
import { ID_EXTRACTOR } from './id-extractor.interface.js';
import { StubIdExtractor } from './stub-id-extractor.js';
import { AnthropicIdExtractor } from './anthropic-id-extractor.js';
import { GeminiIdExtractor } from './gemini-id-extractor.js';

// §user request — "free mein karni hai, Gemini se ho sakti hai": GEMINI_API_KEY (free-tier, no
// billing needed) is tried first since it costs nothing; ANTHROPIC_API_KEY is the paid fallback
// if that's what's configured instead; with neither set, falls back to fake stub data so the
// upload → extract → autofill pipeline stays provable without any key at all.
function pickExtractor() {
  if (process.env.GEMINI_API_KEY) return GeminiIdExtractor;
  if (process.env.ANTHROPIC_API_KEY) return AnthropicIdExtractor;
  return StubIdExtractor;
}

@Module({
  providers: [
    {
      provide: ID_EXTRACTOR,
      useClass: pickExtractor(),
    },
  ],
  exports: [ID_EXTRACTOR],
})
export class IdExtractionModule {}
