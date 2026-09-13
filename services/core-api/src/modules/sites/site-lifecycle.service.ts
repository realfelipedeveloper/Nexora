import { Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  siteCreateSchema,
  siteStatusUpdateSchema,
  type SiteCreateInput,
  type SiteStatusUpdateInput,
} from "@nexora/schemas";
import { InjectPrismaClient } from "../../database/database.module.js";

const siteSelection = {
  createdAt: true,
  id: true,
  key: true,
  name: true,
  status: true,
  updatedAt: true,
} as const;

const maximumTransactionAttempts = 3;

export class InvalidSiteLifecycleInputError extends Error {
  override readonly name = "InvalidSiteLifecycleInputError";

  constructor() {
    super("Site lifecycle input is invalid.");
  }
}

export class SiteKeyConflictError extends Error {
  override readonly name = "SiteKeyConflictError";

  constructor() {
    super("A site with this key already exists.");
  }
}

export class SiteNotFoundError extends Error {
  override readonly name = "SiteNotFoundError";

  constructor() {
    super("Site was not found.");
  }
}

function isPrismaError(error: unknown, code: string) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

function parseCreateInput(input: unknown): SiteCreateInput {
  const result = siteCreateSchema.safeParse(input);
  if (!result.success) {
    throw new InvalidSiteLifecycleInputError();
  }
  return result.data;
}

function parseStatusInput(input: unknown): SiteStatusUpdateInput {
  const result = siteStatusUpdateSchema.safeParse(input);
  if (!result.success) {
    throw new InvalidSiteLifecycleInputError();
  }
  return result.data;
}

@Injectable()
export class SiteLifecycleService {
  constructor(@InjectPrismaClient() private readonly prisma: PrismaClient) {}

  listAccessible(actorId: string, isSystemAdmin: boolean) {
    return this.prisma.site.findMany({
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: siteSelection,
      where: isSystemAdmin ? undefined : { roleAssignments: { some: { userId: actorId } } },
    });
  }

  async get(siteId: string) {
    const site = await this.prisma.site.findUnique({
      select: siteSelection,
      where: { id: siteId },
    });
    if (!site) {
      throw new SiteNotFoundError();
    }
    return site;
  }

  async create(actorId: string, input: unknown) {
    const command = parseCreateInput(input);

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const site = await transaction.site.create({ data: command, select: siteSelection });
        await transaction.auditEvent.create({
          data: {
            action: "site.created",
            actorId,
            entity: "Site",
            entityId: site.id,
            metadata: { key: site.key, status: site.status },
          },
        });
        return site;
      });
    } catch (error) {
      if (isPrismaError(error, "P2002")) {
        throw new SiteKeyConflictError();
      }
      throw error;
    }
  }

  async updateStatus(actorId: string, siteId: string, input: unknown) {
    const command = parseStatusInput(input);

    const updateWithRetry = async (
      attempt: number,
    ): Promise<Awaited<ReturnType<typeof this.get>>> => {
      try {
        return await this.prisma.$transaction(
          async (transaction) => {
            const current = await transaction.site.findUnique({
              select: siteSelection,
              where: { id: siteId },
            });
            if (!current) {
              throw new SiteNotFoundError();
            }
            if (current.status === command.status) {
              return current;
            }

            const site = await transaction.site.update({
              data: { status: command.status },
              select: siteSelection,
              where: { id: siteId },
            });
            await transaction.auditEvent.create({
              data: {
                action: "site.status.changed",
                actorId,
                entity: "Site",
                entityId: site.id,
                metadata: { from: current.status, to: site.status },
              },
            });
            return site;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (isPrismaError(error, "P2034") && attempt < maximumTransactionAttempts) {
          return updateWithRetry(attempt + 1);
        }
        if (isPrismaError(error, "P2025")) {
          throw new SiteNotFoundError();
        }
        throw error;
      }
    };

    return updateWithRetry(1);
  }
}
