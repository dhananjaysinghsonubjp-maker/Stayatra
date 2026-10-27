import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenAI, Type } from '@google/genai';
import type { ExtractedIdDetails, IdExtractor, IdImage } from './id-extractor.interface.js';

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    name: { type: Type.STRING, description: 'Full name as printed on the document' },
    gender: { type: Type.STRING, enum: ['male', 'female', 'other'] },
    dateOfBirth: { type: Type.STRING, description: 'YYYY-MM-DD' },
    address: { type: Type.STRING },
    country: { type: Type.STRING },
    state: { type: Type.STRING },
    city: { type: Type.STRING },
    pincode: { type: Type.STRING },
    idType: { type: Type.STRING, enum: ['aadhaar', 'passport', 'driving_license', 'voter_id', 'other'] },
    idNumber: { type: Type.STRING },
  },
};

/**
 * §user request — "free mein karni hai, RoomNexa bhi Gemini se le rakhi hai": a second
 * IdExtractor implementation, same interface as AnthropicIdExtractor, using Gemini's own
 * free-of-charge API tier (an AI-Studio key with no billing attached) instead of a paid one.
 * The model id is env-configurable (GEMINI_MODEL) since Google's free-eligible model lineup has
 * been changing fast — swap it there, not in code, if a model name gets retired.
 */
@Injectable()
export class GeminiIdExtractor implements IdExtractor {
  private readonly logger = new Logger(GeminiIdExtractor.name);
  private readonly client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  private readonly model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

  async extract(images: IdImage[]): Promise<ExtractedIdDetails> {
    const hasBack = images.some((img) => img.side === 'back');
    const response = await this.client.models.generateContent({
      model: this.model,
      contents: [
        {
          role: 'user',
          parts: [
            ...images.map((img) => ({ inlineData: { mimeType: img.mimeType, data: img.buffer.toString('base64') } })),
            {
              text: hasBack
                ? 'These are front and back photos of a guest ID document at hotel check-in. Extract the fields as JSON, combining both sides — many Indian IDs (e.g. Aadhaar) print the address only on the back. Leave a field out if it is not legible or not present on either side — never guess.'
                : 'This is a photo of a guest ID document at hotel check-in. Extract the fields as JSON. Leave a field out if it is not legible or not present — never guess.',
            },
          ],
        },
      ],
      config: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA },
    });

    const text = response.text;
    if (!text) {
      this.logger.warn('Gemini returned no text for ID extraction');
      return { confidence: 'ai' };
    }
    try {
      return { ...(JSON.parse(text) as Omit<ExtractedIdDetails, 'confidence'>), confidence: 'ai' };
    } catch {
      this.logger.warn('Gemini response was not valid JSON for ID extraction');
      return { confidence: 'ai' };
    }
  }
}
