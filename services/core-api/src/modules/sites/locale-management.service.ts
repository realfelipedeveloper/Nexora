import { Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  localeCodeSchema,
  localeCreateSchema,
  localeUpdateSchema,
  type LocaleCreateInput,
  type LocaleUpdateInput,
} from "@nexora/schemas";
import { InjectPrismaClient } from "../../database/database.module.js";

const maximumLocalesPerSite = 20;

const localeSelection = {
  code: true,
  createdAt: true,
  fallbackLocale: { select: { code: true, id: true } },
  fallbackLocaleId: true,
  id: true,
  isDefault: true,
  updatedAt: true,
  version: true,
} as const;

export type ResolvedLocale = { code: string; id: string };
export type PublicLocaleResolution = {
  locales: ResolvedLocale[];
  requestedLocale: string;
  siteId: string;
};

export class InvalidLocaleInputError extends Error {
  override readonly name = "InvalidLocaleInputError";
  constructor() {
    super("Locale input is invalid.");
  }
}

export class LocaleNotFoundError extends Error {
  override readonly name = "LocaleNotFoundError";
  constructor() {
    super("Locale was not found.");
  }
}

export class LocaleConflictError extends Error {
  override readonly name = "LocaleConflictError";
  constructor(message = "Locale conflicts with the current localization configuration.") {
    super(message);
  }
}

export class LocalePreconditionFailedError extends Error {
  override readonly name = "LocalePreconditionFailedError";
  constructor() {
    super("Locale version precondition failed.");
  }
}

function parse<Value>(
  schema: { safeParse(value: unknown): { data: Value; success: true } | { success: false } },
  value: unknown,
) {
  const result = schema.safeParse(value);
  if (!result.success) throw new InvalidLocaleInputError();
  return result.data;
}

function prismaError(error: unknown, code: string) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

@Injectable()
export class LocaleManagementService {
  constructor(@InjectPrismaClient() private readonly prisma: PrismaClient) {}

  list(siteId: string) {
    return this.prisma.locale.findMany({
      orderBy: [{ isDefault: "desc" }, { code: "asc" }],
      select: localeSelection,
      take: maximumLocalesPerSite,
      where: { siteId },
    });
  }

  async create(actorId: string, siteId: string, input: unknown) {
    const command = parse<LocaleCreateInput>(localeCreateSchema, input);
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const count = await transaction.locale.count({ where: { siteId } });
        if (count >= maximumLocalesPerSite) {
          throw new LocaleConflictError("The site locale limit was reached.");
        }
        const isDefault = count === 0 || command.isDefault === true;
        if (isDefault && command.fallbackLocaleId) {
          throw new LocaleConflictError("The default locale cannot have a fallback.");
        }
        if (command.fallbackLocaleId) {
          await this.requireLocale(transaction, siteId, command.fallbackLocaleId);
        }
        if (isDefault) {
          await transaction.locale.updateMany({ data: { isDefault: false }, where: { siteId } });
        }
        const locale = await transaction.locale.create({
          data: {
            code: command.code,
            fallbackLocaleId: isDefault ? null : (command.fallbackLocaleId ?? null),
            isDefault,
            siteId,
          },
          select: localeSelection,
        });
        await this.audit(transaction, actorId, "localization.locale.created", locale.id, {
          code: locale.code,
          fallbackLocaleId: locale.fallbackLocaleId,
          isDefault: locale.isDefault,
          siteId,
          version: locale.version,
        });
        return locale;
      });
    } catch (error) {
      if (prismaError(error, "P2002")) throw new LocaleConflictError("Locale code already exists.");
      throw error;
    }
  }

  async update(actorId: string, siteId: string, localeId: string, input: unknown, version: number) {
    const command = parse<LocaleUpdateInput>(localeUpdateSchema, input);
    return this.prisma.$transaction(async (transaction) => {
      const current = await transaction.locale.findUnique({
        select: { fallbackLocaleId: true, id: true, isDefault: true },
        where: { id_siteId: { id: localeId, siteId } },
      });
      if (!current) throw new LocaleNotFoundError();
      if (current.isDefault && command.isDefault === false) {
        throw new LocaleConflictError("Assign another default locale instead.");
      }
      const isDefault = command.isDefault ?? current.isDefault;
      const fallbackLocaleId = isDefault
        ? null
        : command.fallbackLocaleId === undefined
          ? current.fallbackLocaleId
          : command.fallbackLocaleId;
      if (fallbackLocaleId) {
        await this.assertFallbackAcyclic(transaction, siteId, localeId, fallbackLocaleId);
      }
      if (command.isDefault === true) {
        await transaction.locale.updateMany({
          data: { isDefault: false },
          where: { id: { not: localeId }, siteId },
        });
      }
      const result = await transaction.locale.updateMany({
        data: { fallbackLocaleId, isDefault, version: { increment: 1 } },
        where: { id: localeId, siteId, version },
      });
      if (result.count !== 1) throw new LocalePreconditionFailedError();
      const locale = await transaction.locale.findUniqueOrThrow({
        select: localeSelection,
        where: { id_siteId: { id: localeId, siteId } },
      });
      await this.audit(transaction, actorId, "localization.locale.updated", locale.id, {
        fallbackLocaleId: locale.fallbackLocaleId,
        isDefault: locale.isDefault,
        previousVersion: version,
        siteId,
        version: locale.version,
      });
      return locale;
    });
  }

  async delete(actorId: string, siteId: string, localeId: string, version: number) {
    try {
      await this.prisma.$transaction(async (transaction) => {
        const locale = await transaction.locale.findUnique({
          select: { code: true, isDefault: true, version: true },
          where: { id_siteId: { id: localeId, siteId } },
        });
        if (!locale) throw new LocaleNotFoundError();
        if (locale.version !== version) throw new LocalePreconditionFailedError();
        if (locale.isDefault)
          throw new LocaleConflictError("The default locale cannot be deleted.");
        await transaction.locale.delete({ where: { id_siteId: { id: localeId, siteId } } });
        await this.audit(transaction, actorId, "localization.locale.deleted", localeId, {
          code: locale.code,
          previousVersion: version,
          siteId,
        });
      });
    } catch (error) {
      if (prismaError(error, "P2003")) {
        throw new LocaleConflictError("Locale is still referenced and cannot be deleted.");
      }
      throw error;
    }
  }

  async resolvePublic(
    siteKey: string,
    requestedCode: string,
  ): Promise<PublicLocaleResolution | null> {
    const requestedLocale = parse<string>(localeCodeSchema, requestedCode);
    const site = await this.prisma.site.findFirst({
      select: {
        id: true,
        locales: {
          orderBy: [{ isDefault: "desc" }, { code: "asc" }],
          select: { code: true, fallbackLocaleId: true, id: true, isDefault: true },
          take: maximumLocalesPerSite,
        },
      },
      where: { key: siteKey, status: "ACTIVE" },
    });
    const defaultLocale = site?.locales.find((locale) => locale.isDefault);
    if (!site || !defaultLocale) return null;
    const byId = new Map(site.locales.map((locale) => [locale.id, locale]));
    const requested = site.locales.find((locale) => locale.code === requestedLocale);
    const locales: ResolvedLocale[] = [];
    const visited = new Set<string>();
    let current: (typeof site.locales)[number] | undefined = requested ?? defaultLocale;
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      locales.push({ code: current.code, id: current.id });
      current = current.fallbackLocaleId ? byId.get(current.fallbackLocaleId) : undefined;
    }
    if (!visited.has(defaultLocale.id)) {
      locales.push({ code: defaultLocale.code, id: defaultLocale.id });
    }
    return { locales, requestedLocale, siteId: site.id };
  }

  private async assertFallbackAcyclic(
    transaction: Prisma.TransactionClient,
    siteId: string,
    localeId: string,
    fallbackLocaleId: string,
  ) {
    const locales = await transaction.locale.findMany({
      select: { fallbackLocaleId: true, id: true },
      take: maximumLocalesPerSite,
      where: { siteId },
    });
    if (!locales.some((locale) => locale.id === fallbackLocaleId)) throw new LocaleConflictError();
    const fallbackById = new Map(locales.map((locale) => [locale.id, locale.fallbackLocaleId]));
    fallbackById.set(localeId, fallbackLocaleId);
    const visited = new Set<string>();
    let current: string | null | undefined = localeId;
    while (current) {
      if (visited.has(current))
        throw new LocaleConflictError("Locale fallback cannot form a cycle.");
      visited.add(current);
      current = fallbackById.get(current);
    }
  }

  private async requireLocale(
    transaction: Prisma.TransactionClient,
    siteId: string,
    localeId: string,
  ) {
    const locale = await transaction.locale.findUnique({
      select: { id: true },
      where: { id_siteId: { id: localeId, siteId } },
    });
    if (!locale) throw new LocaleConflictError();
  }

  private audit(
    transaction: Prisma.TransactionClient,
    actorId: string,
    action: string,
    entityId: string,
    metadata: Prisma.InputJsonObject,
  ) {
    return transaction.auditEvent.create({
      data: { action, actorId, entity: "Locale", entityId, metadata },
    });
  }
}
