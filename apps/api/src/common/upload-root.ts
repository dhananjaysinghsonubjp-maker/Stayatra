import path from 'node:path';

// §bugfix — "logo upload karne ke baad thode time baad hat jata hai": every uploaded file (hotel
// logo, ID photos, room/cleaning photos, receipts, staff IDs…) was written to a plain path relative
// to process.cwd() on local disk. On Railway that disk isn't persisted — a fresh deploy rebuilds
// the container's filesystem from scratch, silently wiping every file written at runtime, so a
// logo that worked yesterday 404s after the next push. UPLOAD_DIR points this at a Railway Volume
// (a real persistent disk, mounted outside the container's own ephemeral filesystem) instead, set
// only in production; left unset, this still resolves exactly as before for local dev.
export const UPLOAD_ROOT = process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : path.resolve(process.cwd(), 'uploads');
