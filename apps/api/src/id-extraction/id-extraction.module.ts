import { Module } from '@nestjs/common';
import { ID_EXTRACTOR } from './id-extractor.interface.js';
import { StubIdExtractor } from './stub-id-extractor.js';
import { AnthropicIdExtractor } from './anthropic-id-extractor.js';

@Module({
  providers: [
    {
      provide: ID_EXTRACTOR,
      useClass: process.env.ANTHROPIC_API_KEY ? AnthropicIdExtractor : StubIdExtractor,
    },
  ],
  exports: [ID_EXTRACTOR],
})
export class IdExtractionModule {}
