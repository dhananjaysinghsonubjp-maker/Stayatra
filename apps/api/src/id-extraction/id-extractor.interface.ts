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

export interface IdExtractor {
  extract(imageBuffer: Buffer, mimeType: string): Promise<ExtractedIdDetails>;
}

export const ID_EXTRACTOR = Symbol('ID_EXTRACTOR');
