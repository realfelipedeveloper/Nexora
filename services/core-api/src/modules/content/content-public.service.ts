import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { PublicContentEntry, PublicContentPage } from "@nexora/contracts";
import { InjectPrismaClient } from "../../database/database.module.js";
import { ContentMetrics } from "./content-metrics.js";

const defaultPageSize = 25;
const maximumPageSize = 100;
const maximumCursorLength = 512;
const keyPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const localePattern = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

type PublicContentQuery = {
  cursor?: string;
  limit?: string;
  locale?: string;
};

type PublicContentCursor = {
  id: string;
  publishedAt: Date;
};

type PublicContentContext = {
  contentTypeId: string;
  contentTypeKey: string;
  localeCode: string;
  localeId: string;
  siteId: string;
};

type PublicEntryRecord = {
  contentLocales: Array<{ data: Prisma.JsonValue }>;
  id: string;
  publishedAt: Date | null;
  schemaVersion: number;
  updatedAt: Date;
};

export class InvalidPublicContentQueryError extends Error {
  override readonly name = "InvalidPublicContentQueryError";

  constructor() {
    super("Public content query parameters are invalid.");
  }
}

function parseLimit(rawLimit: string | undefined) {
  const value = rawLimit ?? String(defaultPageSize);
  if (!/^[1-9][0-9]{0,2}$/u.test(value)) {
    throw new InvalidPublicContentQueryError();
  }
  const limit = Number(value);
  if (limit > maximumPageSize) {
    throw new InvalidPublicContentQueryError();
  }
  return limit;
}

function decodeCursor(value: string | undefined): PublicContentCursor | undefined {
  if (!value) {
    return undefined;
  }
  if (value.length > maximumCursorLength || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new InvalidPublicContentQueryError();
  }

  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new InvalidPublicContentQueryError();
    }
    const candidate = parsed as Record<string, unknown>;
    if (
      Object.keys(candidate).length !== 2 ||
      typeof candidate.id !== "string" ||
      !uuidPattern.test(candidate.id) ||
      typeof candidate.publishedAt !== "string"
    ) {
      throw new InvalidPublicContentQueryError();
    }
    const publishedAt = new Date(candidate.publishedAt);
    if (
      Number.isNaN(publishedAt.getTime()) ||
      publishedAt.toISOString() !== candidate.publishedAt
    ) {
      throw new InvalidPublicContentQueryError();
    }
    return { id: candidate.id, publishedAt };
  } catch (error) {
    if (error instanceof InvalidPublicContentQueryError) {
      throw error;
    }
    throw new InvalidPublicContentQueryError();
  }
}

function encodeCursor(entry: PublicEntryRecord) {
  if (!entry.publishedAt) {
    throw new Error("Published content is missing its publication timestamp.");
  }
  return Buffer.from(
    JSON.stringify({ id: entry.id, publishedAt: entry.publishedAt.toISOString() }),
  ).toString("base64url");
}

function parseQuery(siteKey: string, contentTypeKey: string, query: PublicContentQuery) {
  if (
    siteKey.length > 63 ||
    !keyPattern.test(siteKey) ||
    contentTypeKey.length > 63 ||
    !keyPattern.test(contentTypeKey) ||
    !query.locale ||
    query.locale.length > 35 ||
    !localePattern.test(query.locale)
  ) {
    throw new InvalidPublicContentQueryError();
  }
  return {
    cursor: decodeCursor(query.cursor),
    limit: parseLimit(query.limit),
    locale: query.locale,
  };
}

function cursorFilter(cursor: PublicContentCursor | undefined): Prisma.ContentEntryWhereInput {
  if (!cursor) {
    return {};
  }
  return {
    OR: [
      { publishedAt: { lt: cursor.publishedAt } },
      { id: { lt: cursor.id }, publishedAt: cursor.publishedAt },
    ],
  };
}

function projectEntry(entry: PublicEntryRecord, context: PublicContentContext): PublicContentEntry {
  const localized = entry.contentLocales[0];
  if (!entry.publishedAt || !localized) {
    throw new Error("Published content projection is incomplete.");
  }
  return {
    contentType: { key: context.contentTypeKey },
    data: localized.data as Record<string, unknown>,
    id: entry.id,
    locale: context.localeCode,
    publishedAt: entry.publishedAt.toISOString(),
    schemaVersion: entry.schemaVersion,
    updatedAt: entry.updatedAt.toISOString(),
  };
}

@Injectable()
export class PublicContentService {
  constructor(
    @InjectPrismaClient() private readonly prisma: PrismaClient,
    @Inject(ContentMetrics) private readonly metrics: ContentMetrics,
  ) {}

  async list(
    siteKey: string,
    contentTypeKey: string,
    query: PublicContentQuery,
  ): Promise<PublicContentPage | null> {
    const parsed = parseQuery(siteKey, contentTypeKey, query);
    const context = await this.resolveContext(siteKey, contentTypeKey, parsed.locale);
    if (!context) {
      this.metrics.recordPublicRead("list", "miss");
      return null;
    }

    const records = await this.prisma.contentEntry.findMany({
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      select: {
        contentLocales: {
          select: { data: true },
          take: 1,
          where: { localeId: context.localeId },
        },
        id: true,
        publishedAt: true,
        schemaVersion: true,
        updatedAt: true,
      },
      take: parsed.limit + 1,
      where: {
        ...cursorFilter(parsed.cursor),
        contentLocales: { some: { localeId: context.localeId } },
        contentTypeId: context.contentTypeId,
        publishedAt: { not: null },
        siteId: context.siteId,
        status: "PUBLISHED",
      },
    });
    const hasNextPage = records.length > parsed.limit;
    const visibleRecords = records.slice(0, parsed.limit);
    const lastVisible = visibleRecords.at(-1);
    this.metrics.recordPublicRead("list", "hit");

    return {
      items: visibleRecords.map((entry) => projectEntry(entry, context)),
      nextCursor: hasNextPage && lastVisible ? encodeCursor(lastVisible) : null,
    };
  }

  async get(
    siteKey: string,
    contentTypeKey: string,
    entryId: string,
    locale: string | undefined,
  ): Promise<PublicContentEntry | null> {
    const parsed = parseQuery(siteKey, contentTypeKey, { locale });
    if (!uuidPattern.test(entryId)) {
      throw new InvalidPublicContentQueryError();
    }
    const context = await this.resolveContext(siteKey, contentTypeKey, parsed.locale);
    if (!context) {
      this.metrics.recordPublicRead("detail", "miss");
      return null;
    }

    const entry = await this.prisma.contentEntry.findFirst({
      select: {
        contentLocales: {
          select: { data: true },
          take: 1,
          where: { localeId: context.localeId },
        },
        id: true,
        publishedAt: true,
        schemaVersion: true,
        updatedAt: true,
      },
      where: {
        contentLocales: { some: { localeId: context.localeId } },
        contentTypeId: context.contentTypeId,
        id: entryId,
        publishedAt: { not: null },
        siteId: context.siteId,
        status: "PUBLISHED",
      },
    });
    this.metrics.recordPublicRead("detail", entry ? "hit" : "miss");
    return entry ? projectEntry(entry, context) : null;
  }

  private async resolveContext(
    siteKey: string,
    contentTypeKey: string,
    localeCode: string,
  ): Promise<PublicContentContext | null> {
    const site = await this.prisma.site.findFirst({
      select: {
        contentTypes: {
          select: { id: true, key: true },
          take: 1,
          where: { key: contentTypeKey },
        },
        id: true,
        locales: {
          select: { code: true, id: true },
          take: 1,
          where: { code: localeCode },
        },
      },
      where: { key: siteKey, status: "ACTIVE" },
    });
    const contentType = site?.contentTypes[0];
    const locale = site?.locales[0];
    if (!site || !contentType || !locale) {
      return null;
    }
    return {
      contentTypeId: contentType.id,
      contentTypeKey: contentType.key,
      localeCode: locale.code,
      localeId: locale.id,
      siteId: site.id,
    };
  }
}
