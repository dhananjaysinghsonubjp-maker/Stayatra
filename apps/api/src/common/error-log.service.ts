import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

// §user request — "jo jo errors aa rahe hai live system me unka ek log create karte raho, jab
// main mangu tab dena": never save payment/ID/credential fields even if they show up somewhere
// unexpected in a request's input — this log exists to help debug crashes, not to become a second
// place sensitive guest data sits.
const SENSITIVE_KEYS = new Set([
  'password',
  'passwordHash',
  'pin',
  'pinHash',
  'token',
  'otp',
  'idNumber',
  'idPhotoPath',
  'idPhotoBackPath',
  'guestPhone',
  'phone',
  'companyGstin',
  'cardNumber',
  'cvv',
  'credentials',
  'credentialRef',
]);

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEYS.has(key) ? '[redacted]' : redact(val, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 500) return `${value.slice(0, 500)}…`;
  return value;
}

@Injectable()
export class ErrorLogService {
  constructor(private readonly prisma: PrismaService) {}

  /** Called once, centrally, from main.ts's tRPC onError hook — never let logging a crash cause
   * another one; a failure here is swallowed, not re-thrown. */
  async log(input: { path?: string; message: string; stack?: string; hotelId?: string | null; userId?: string | null; input?: unknown }) {
    try {
      await this.prisma.errorLog.create({
        data: {
          path: input.path,
          message: input.message.slice(0, 2000),
          stack: input.stack?.slice(0, 4000),
          hotelId: input.hotelId ?? undefined,
          userId: input.userId ?? undefined,
          input: (redact(input.input) as Prisma.InputJsonValue) ?? undefined,
        },
      });
    } catch {
      // DB hiccup while logging a DB hiccup — nothing useful to do but drop it.
    }
  }

  list(limit = 200) {
    return this.prisma.errorLog.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
  }

  async clear() {
    const { count } = await this.prisma.errorLog.deleteMany({});
    return { cleared: count };
  }
}
