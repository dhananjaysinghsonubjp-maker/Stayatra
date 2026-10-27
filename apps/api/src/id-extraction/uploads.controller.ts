import { Controller, Post, UploadedFile, UploadedFiles, UseInterceptors, Inject, UnauthorizedException, Headers, BadRequestException } from '@nestjs/common';
import { FileFieldsInterceptor, FileInterceptor } from '@nestjs/platform-express';
import type {} from 'multer'; // side-effect import: activates the global Express.Multer.File augmentation
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AuthService } from '../auth/auth.service.js';
import { ID_EXTRACTOR, type IdExtractor } from './id-extractor.interface.js';

const UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads'); // dev-only local disk — S3 in production, per §3
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 8 * 1024 * 1024;

// Outside tRPC deliberately — tRPC's JSON transport doesn't carry multipart
// file uploads cleanly. Same Bearer-token auth as every tRPC procedure,
// just checked by hand here instead of via context middleware.
@Controller('uploads')
export class UploadsController {
  constructor(
    private readonly auth: AuthService,
    @Inject(ID_EXTRACTOR) private readonly extractor: IdExtractor,
  ) {}

  private async requireUser(authHeader?: string) {
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : undefined;
    const user = token ? await this.auth.resolveSession(token) : null;
    if (!user) throw new UnauthorizedException();
    return user;
  }

  private async save(subdir: string, file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    if (!ALLOWED_MIME.has(file.mimetype)) throw new BadRequestException('Only JPEG/PNG/WebP images are accepted');

    const dir = path.join(UPLOAD_ROOT, subdir);
    await mkdir(dir, { recursive: true });
    const filename = `${randomUUID()}${path.extname(file.originalname) || '.jpg'}`;
    await writeFile(path.join(dir, filename), file.buffer);
    return path.join('uploads', subdir, filename);
  }

  // §user request — "aadhaar front and back dono upload, AI dono se details padhe": front is
  // required, back optional; re-sent (with front again) once the back photo is added too, so
  // extraction always runs across whatever sides are available at that moment.
  @Post('id-scan')
  @UseInterceptors(FileFieldsInterceptor([{ name: 'front', maxCount: 1 }, { name: 'back', maxCount: 1 }], { limits: { fileSize: MAX_BYTES } }))
  async uploadIdScan(
    @UploadedFiles() files: { front?: Express.Multer.File[]; back?: Express.Multer.File[] },
    @Headers('authorization') authHeader?: string,
  ) {
    await this.requireUser(authHeader);
    const front = files.front?.[0];
    const back = files.back?.[0];
    if (!front) throw new BadRequestException('Front side photo is required');

    const [filePath, backFilePath] = await Promise.all([this.save('id-scans', front), back ? this.save('id-scans', back) : Promise.resolve(undefined)]);
    const extracted = await this.extractor.extract([
      { buffer: front.buffer, mimeType: front.mimetype, side: 'front' },
      ...(back ? [{ buffer: back.buffer, mimeType: back.mimetype, side: 'back' as const }] : []),
    ]);
    return { filePath, backFilePath, extracted };
  }

  /** No AI extraction — just storage, for payment receipt photos (§ added beyond MD spec). */
  @Post('receipt')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  async uploadReceipt(@UploadedFile() file: Express.Multer.File, @Headers('authorization') authHeader?: string) {
    await this.requireUser(authHeader);
    const filePath = await this.save('receipts', file);
    return { filePath };
  }

  /** Room Details page's photo gallery (§ user request) — storage only, same as receipts. */
  @Post('room-photo')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  async uploadRoomPhoto(@UploadedFile() file: Express.Multer.File, @Headers('authorization') authHeader?: string) {
    await this.requireUser(authHeader);
    const filePath = await this.save('room-photos', file);
    return { filePath };
  }

  /** "List Your Property" Photos And Videos step's property-level gallery — storage only, same as receipts. */
  @Post('hotel-photo')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  async uploadHotelPhoto(@UploadedFile() file: Express.Multer.File, @Headers('authorization') authHeader?: string) {
    await this.requireUser(authHeader);
    const filePath = await this.save('hotel-photos', file);
    return { filePath };
  }

  /** Housekeeping cleaning evidence (§8.6, matching the Skymax reference app) — storage only,
   * same as receipts. Uploaded one at a time from the client (sequential, not Promise.all — a
   * batch upload OOM-crashed low-end phones in the Skymax app this is modelled on). */
  @Post('cleaning-photo')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  async uploadCleaningPhoto(@UploadedFile() file: Express.Multer.File, @Headers('authorization') authHeader?: string) {
    await this.requireUser(authHeader);
    const filePath = await this.save('cleaning-photos', file);
    return { filePath };
  }

  /** Staff profile photo (§ user request — a full staff profile, not just name+PIN) — storage only, same as receipts. */
  @Post('staff-photo')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  async uploadStaffPhoto(@UploadedFile() file: Express.Multer.File, @Headers('authorization') authHeader?: string) {
    await this.requireUser(authHeader);
    const filePath = await this.save('staff-photos', file);
    return { filePath };
  }

  /** Staff ID document (Aadhar card) — storage only, same as receipts. */
  @Post('staff-id')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  async uploadStaffId(@UploadedFile() file: Express.Multer.File, @Headers('authorization') authHeader?: string) {
    await this.requireUser(authHeader);
    const filePath = await this.save('staff-ids', file);
    return { filePath };
  }
}
