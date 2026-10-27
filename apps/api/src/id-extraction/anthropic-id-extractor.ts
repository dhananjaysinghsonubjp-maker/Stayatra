import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import type { ExtractedIdDetails, IdExtractor, IdImage } from './id-extractor.interface.js';

const EXTRACT_TOOL = {
  name: 'record_id_details',
  description: 'Record the details read off a government ID document photo.',
  input_schema: {
    type: 'object' as const,
    properties: {
      name: { type: 'string', description: 'Full name as printed on the document' },
      gender: { type: 'string', enum: ['male', 'female', 'other'] },
      dateOfBirth: { type: 'string', description: 'YYYY-MM-DD' },
      address: { type: 'string' },
      country: { type: 'string' },
      state: { type: 'string' },
      city: { type: 'string' },
      pincode: { type: 'string' },
      idType: { type: 'string', enum: ['aadhaar', 'passport', 'driving_license', 'voter_id', 'other'] },
      idNumber: { type: 'string' },
    },
  },
};

/**
 * Real "AI Check-in" implementation — Claude's vision capability doing what a
 * traditional OCR/ID-verification API would, without needing a separate
 * vendor integration. Only used when ANTHROPIC_API_KEY is set (see
 * id-extraction.module.ts); this is an app-runtime API call the deployed
 * product makes on its own, unrelated to whatever built this code.
 */
@Injectable()
export class AnthropicIdExtractor implements IdExtractor {
  private readonly logger = new Logger(AnthropicIdExtractor.name);
  private readonly client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  async extract(images: IdImage[]): Promise<ExtractedIdDetails> {
    const hasBack = images.some((img) => img.side === 'back');
    const message = await this.client.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 1024,
      tools: [EXTRACT_TOOL],
      tool_choice: { type: 'tool', name: 'record_id_details' },
      messages: [
        {
          role: 'user',
          content: [
            ...images.map(
              (img) =>
                ({
                  type: 'image' as const,
                  source: { type: 'base64' as const, media_type: img.mimeType as 'image/jpeg' | 'image/png' | 'image/webp', data: img.buffer.toString('base64') },
                }) satisfies Anthropic.ImageBlockParam,
            ),
            {
              type: 'text',
              text: hasBack
                ? 'These are front and back photos of a guest ID document at hotel check-in. Extract the fields into record_id_details, combining both sides — many Indian IDs (e.g. Aadhaar) print the address only on the back. Leave a field out if it is not legible or not present on either side — never guess.'
                : 'This is a photo of a guest ID document at hotel check-in. Extract the fields into record_id_details. Leave a field out if it is not legible or not present — never guess.',
            },
          ],
        },
      ],
    });

    const toolUse = message.content.find((block) => block.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use') {
      this.logger.warn('Claude did not return a tool_use block for ID extraction');
      return { confidence: 'ai' };
    }

    return { ...(toolUse.input as Omit<ExtractedIdDetails, 'confidence'>), confidence: 'ai' };
  }
}
