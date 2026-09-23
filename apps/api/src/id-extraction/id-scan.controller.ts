import { Controller, Post, UploadedFile, UseInterceptors, Inject, UnauthorizedException, Headers, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type {} from 'multer'; // side-effect import: activates the global Express.Multer.File augmentation
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AuthService } from '../auth/auth.service.js';
import { ID_EXTRACTOR, type IdExtractor } from './id-extractor.interface.js';

const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads', 'id-scans'); // dev-only local disk — S3 in production, per §3
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 8 * 1024 * 1024;

// Outside tRPC deliberately — tRPC's JSON transport doesn't carry multipart
// file uploads cleanly. Same Bearer-token auth as every tRPC procedure,
// just checked by hand here instead of via context middleware.
@Controller('uploads')
export class IdScanController {
  constructor(
    private readonly auth: AuthService,
    @Inject(ID_EXTRACTOR) private readonly extractor: IdExtractor,
  ) {}

  @Post('id-scan')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  async uploadIdScan(@UploadedFile() file: Express.Multer.File, @Headers('authorization') authHeader?: string) {
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : undefined;
    const user = token ? await this.auth.resolveSession(token) : null;
    if (!user) throw new UnauthorizedException();

    if (!file) throw new BadRequestException('No file uploaded');
    if (!ALLOWED_MIME.has(file.mimetype)) throw new BadRequestException('Only JPEG/PNG/WebP images are accepted');

    await mkdir(UPLOAD_DIR, { recursive: true });
    const filename = `${randomUUID()}${path.extname(file.originalname) || '.jpg'}`;
    const filePath = path.join(UPLOAD_DIR, filename);
    await writeFile(filePath, file.buffer);

    const extracted = await this.extractor.extract(file.buffer, file.mimetype);

    return { filePath: path.join('uploads', 'id-scans', filename), extracted };
  }
}
