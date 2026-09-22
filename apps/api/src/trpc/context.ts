import type { CreateExpressContextOptions } from '@trpc/server/adapters/express';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuthService } from '../auth/auth.service.js';

export interface ActingUser {
  userId: string;
  organizationId: string;
  hotelId: string | null;
  roles: Record<string, string>; // module -> role, e.g. { pms: 'front_desk' }
}

export function createContextFactory(prisma: PrismaService, auth: AuthService) {
  return async function createContext({ req }: CreateExpressContextOptions) {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
    const user: ActingUser | null = token ? await auth.resolveSession(token) : null;

    return { prisma, user };
  };
}

export type Context = Awaited<ReturnType<ReturnType<typeof createContextFactory>>>;
