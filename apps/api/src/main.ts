import { NestFactory } from '@nestjs/core';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { AppModule } from './app.module.js';
import { PrismaService } from './prisma/prisma.service.js';
import { appRouter } from './trpc/app.router.js';
import { createContextFactory } from './trpc/context.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const prisma = app.get(PrismaService);
  app.use(
    '/trpc',
    createExpressMiddleware({
      router: appRouter,
      createContext: createContextFactory(prisma),
    }),
  );

  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
