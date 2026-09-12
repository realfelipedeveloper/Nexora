import { Inject, Injectable, Module, type OnApplicationShutdown } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { createPrismaClient } from "./prisma-client.js";

const localDatabaseUrl =
  "postgresql://nexora:nexora_dev_password@localhost:48130/nexora?schema=public";

export const PRISMA_CLIENT = Symbol("PRISMA_CLIENT");
export const InjectPrismaClient = () => Inject(PRISMA_CLIENT);

export function resolveDatabaseUrl(environment: NodeJS.ProcessEnv = process.env) {
  if (environment.DATABASE_URL) {
    return environment.DATABASE_URL;
  }

  if (environment.NODE_ENV === "production") {
    throw new TypeError("DATABASE_URL must be explicitly set in production.");
  }

  return localDatabaseUrl;
}

@Injectable()
class PrismaLifecycle implements OnApplicationShutdown {
  constructor(@InjectPrismaClient() private readonly prisma: PrismaClient) {}

  async onApplicationShutdown() {
    await this.prisma.$disconnect();
  }
}

@Module({
  exports: [PRISMA_CLIENT],
  providers: [
    {
      provide: PRISMA_CLIENT,
      useFactory: () => createPrismaClient(resolveDatabaseUrl()),
    },
    PrismaLifecycle,
  ],
})
export class DatabaseModule {}
