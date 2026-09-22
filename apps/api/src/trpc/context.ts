import type { CreateExpressContextOptions } from '@trpc/server/adapters/express';
import type { PrismaService } from '../prisma/prisma.service.js';

export function createContextFactory(prisma: PrismaService) {
  return function createContext({ req }: CreateExpressContextOptions) {
    // auth resolution (JWT / PIN session -> user_id -> organization_id -> entitled
    // modules -> role per module, per §4) lands here once auth is built. Never trust
    // a client-supplied role.
    return { prisma, req };
  };
}

export type Context = ReturnType<ReturnType<typeof createContextFactory>>;
