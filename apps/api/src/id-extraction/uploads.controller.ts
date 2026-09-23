import { Controller, Post, UploadedFile, UseInterceptors, Inject, UnauthorizedException, Headers, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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

  @Post('id-scan')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  async uploadIdScan(@UploadedFile() file: Express.Multer.File, @Headers('authorization') authHeader?: string) {
    await this.requireUser(authHeader);
    const filePath = await this.save('id-scans', file);
    const extracted = await this.extractor.extract(file.buffer, file.mimetype);
    return { filePath, extracted };
  }

  /** No AI extraction — just storage, for payment receipt photos (§ added beyond MD spec). */
  @Post('receipt')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  async uploadReceipt(@UploadedFile() file: Express.Multer.File, @Headers('authorization') authHeader?: string) {
    await this.requireUser(authHeader);
    const filePath = await this.save('receipts', file);
    return { filePath };
  }
}
