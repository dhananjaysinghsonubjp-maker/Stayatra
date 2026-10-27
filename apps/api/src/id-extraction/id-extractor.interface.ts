export interface ExtractedIdDetails {
  name?: string;
  gender?: 'male' | 'female' | 'other';
  dateOfBirth?: string; // YYYY-MM-DD
  address?: string;
  country?: string;
  state?: string;
  city?: string;
  pincode?: string;
  idType?: 'aadhaar' | 'passport' | 'driving_license' | 'voter_id' | 'other';
  idNumber?: string;
  confidence: 'stub' | 'ai'; // lets the UI show "verify this — AI-extracted" vs. obviously-fake stub data
}

export interface IdImage {
  buffer: Buffer;
  mimeType: string;
  side: 'front' | 'back';
}

export interface IdExtractor {
  /** One image (front only) or two (front + back) — the back side especially helps with
   * address, which Aadhaar prints there rather than on the front. */
  extract(images: IdImage[]): Promise<ExtractedIdDetails>;
}

export const ID_EXTRACTOR = Symbol('ID_EXTRACTOR');
