import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';

const ALGORITHM = 'aes-256-gcm';

// §7 Phase 1 #13 / §11's anti-pattern warning: never store OTA credentials in
// a client-readable token — encrypted at rest here, decrypted only server-side
// when an adapter actually needs to make a call. CREDENTIAL_VAULT_KEY should
// be a real 32-byte base64 key in production; falls back to a fixed, clearly
// insecure dev key (loud warning) so local dev doesn't need one set up.
function resolveKey(): Buffer {
  const envKey = process.env.CREDENTIAL_VAULT_KEY;
  if (envKey) return Buffer.from(envKey, 'base64');
  new Logger('CredentialVaultService').warn(
    'CREDENTIAL_VAULT_KEY not set — using an insecure fixed dev key. Never do this in production.',
  );
  return scryptSync('dev-only-insecure-vault-key', 'hotel-platform', 32);
}

@Injectable()
export class CredentialVaultService {
  private readonly key = resolveKey();

  constructor(private readonly prisma: PrismaService) {}

  /** Encrypts and stores credentials for one OTA connection, replacing any prior value. */
  async storeCredentials(otaConnectionId: string, credentials: Record<string, string>) {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const cipherText = Buffer.concat([cipher.update(JSON.stringify(credentials), 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const record = await this.prisma.otaCredential.upsert({
      where: { otaConnectionId },
      create: {
        otaConnectionId,
        cipherText: cipherText.toString('base64'),
        iv: iv.toString('base64'),
        authTag: authTag.toString('base64'),
      },
      update: {
        cipherText: cipherText.toString('base64'),
        iv: iv.toString('base64'),
        authTag: authTag.toString('base64'),
      },
    });
    await this.prisma.otaConnection.update({ where: { id: otaConnectionId }, data: { credentialRef: record.id } });
    return { savedAt: record.updatedAt };
  }

  /** Status only — never returns plaintext or ciphertext to a caller (routers never expose this beyond a boolean). */
  async getStatus(otaConnectionId: string) {
    const record = await this.prisma.otaCredential.findUnique({ where: { otaConnectionId } });
    return { hasCredentials: Boolean(record), updatedAt: record?.updatedAt ?? null };
  }

  /** For real adapters (future work) to resolve credentials at push time — never exposed via a router. */
  async decrypt(otaConnectionId: string): Promise<Record<string, string>> {
    const record = await this.prisma.otaCredential.findUnique({ where: { otaConnectionId } });
    if (!record) throw new NotFoundException('No credentials stored for this connection');
    const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(record.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(record.authTag, 'base64'));
    const plain = Buffer.concat([decipher.update(Buffer.from(record.cipherText, 'base64')), decipher.final()]);
    return JSON.parse(plain.toString('utf8'));
  }
}
