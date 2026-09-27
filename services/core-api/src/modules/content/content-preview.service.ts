import { createHash, randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { contentEntrySnapshotLocalesSchema } from "@nexora/schemas";
import { z } from "zod";
import { InjectPrismaClient } from "../../database/database.module.js";
import { ContentMetrics } from "./content-metrics.js";

const tokenBytes = 24;
const tokenPattern = /^[A-Za-z0-9_-]{32}$/u;
const defaultPreviewTtlSeconds = 300;
const minimumPreviewTtlSeconds = 30;
const maximumPreviewTtlSeconds = 900;

const previewRequestSchema = z.strictObject({
  localeId: z.string().uuid().optional(),
  revision: z.number().int().positive().max(2_147_483_647).optional(),
});

type PreviewRequest = z.infer<typeof previewRequestSchema>;

export class InvalidContentPreviewRequestError extends Error {
  override readonly name = "InvalidContentPreviewRequestError";

  constructor() {
    super("Content preview request is invalid.");
  }
}

export class ContentPreviewNotFoundError extends Error {
  override readonly name = "ContentPreviewNotFoundError";

  constructor() {
    super("Content preview was not found.");
  }
}

export function contentPreviewTtlMs(rawValue = process.env.CONTENT_PREVIEW_TTL_SECONDS) {
  const value = rawValue ?? String(defaultPreviewTtlSeconds);
  if (!/^[1-9][0-9]{1,2}$/u.test(value)) {
    throw new Error(
      `CONTENT_PREVIEW_TTL_SECONDS must be an integer between ${minimumPreviewTtlSeconds} and ${maximumPreviewTtlSeconds}.`,
    );
  }
  const seconds = Number(value);
  if (seconds < minimumPreviewTtlSeconds || seconds > maximumPreviewTtlSeconds) {
    throw new Error(
      `CONTENT_PREVIEW_TTL_SECONDS must be an integer between ${minimumPreviewTtlSeconds} and ${maximumPreviewTtlSeconds}.`,
    );
  }
  return seconds * 1_000;
}

function tokenHash(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function referencesAsset(value: unknown, assetId: string): boolean {
  const pending = [value];
  let visited = 0;
  while (pending.length > 0 && visited < 10_000) {
    const candidate = pending.pop();
    visited += 1;
    if (!candidate || typeof candidate !== "object") continue;
    if (Array.isArray(candidate)) {
      pending.push(...candidate);
      continue;
    }
    const record = candidate as Record<string, unknown>;
    if (
      record.type === "asset" &&
      record.attrs &&
      typeof record.attrs === "object" &&
      !Array.isArray(record.attrs) &&
      (record.attrs as Record<string, unknown>).assetId === assetId
    ) {
      return true;
    }
    pending.push(...Object.values(record));
  }
  return false;
}

@Injectable()
export class ContentPreviewService {
  private readonly ttlMs = contentPreviewTtlMs();

  constructor(
    @InjectPrismaClient() private readonly prisma: PrismaClient,
    @Inject(ContentMetrics) private readonly metrics: ContentMetrics,
  ) {}

  async issue(actorId: string, siteId: string, contentEntryId: string, input: unknown) {
    const request = this.parseRequest(input);
    const entry = await this.prisma.contentEntry.findUnique({
      select: { id: true, revision: true },
      where: { id_siteId: { id: contentEntryId, siteId } },
    });
    if (!entry) {
      this.metrics.recordPreviewOperation("issue_miss");
      throw new ContentPreviewNotFoundError();
    }

    const revision = request.revision ?? entry.revision;
    const snapshot = await this.prisma.contentEntrySnapshot.findUnique({
      select: { locales: true },
      where: { contentEntryId_siteId_revision: { contentEntryId, revision, siteId } },
    });
    if (!snapshot) {
      this.metrics.recordPreviewOperation("issue_miss");
      throw new ContentPreviewNotFoundError();
    }
    const locales = contentEntrySnapshotLocalesSchema.parse(snapshot.locales);
    const locale = request.localeId
      ? locales.find((candidate) => candidate.localeId === request.localeId)
      : locales[0];
    if (!locale) {
      this.metrics.recordPreviewOperation("issue_miss");
      throw new ContentPreviewNotFoundError();
    }

    const token = randomBytes(tokenBytes).toString("base64url");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.ttlMs);
    const created = await this.prisma.$transaction(async (transaction) => {
      await transaction.contentPreviewToken.deleteMany({
        where: { OR: [{ expiresAt: { lte: now } }, { revokedAt: { not: null } }] },
      });
      const previewToken = await transaction.contentPreviewToken.create({
        data: {
          contentEntryId,
          createdById: actorId,
          expiresAt,
          localeId: locale.localeId,
          revision,
          siteId,
          tokenHash: tokenHash(token),
        },
        select: { id: true },
      });
      await transaction.auditEvent.create({
        data: {
          action: "content.preview.issued",
          actorId,
          entity: "ContentEntry",
          entityId: contentEntryId,
          metadata: {
            expiresAt: expiresAt.toISOString(),
            localeId: locale.localeId,
            previewTokenId: previewToken.id,
            revision,
            siteId,
          },
        },
      });
      return previewToken;
    });
    this.metrics.recordPreviewOperation("issued");
    return {
      expiresAt: expiresAt.toISOString(),
      id: created.id,
      localeId: locale.localeId,
      revision,
      token,
    };
  }

  async redeem(token: string) {
    const resolved = await this.resolveToken(token);
    const locale = resolved.locales.find((item) => item.localeId === resolved.token.localeId);
    if (!locale) throw new ContentPreviewNotFoundError();

    const schedule =
      resolved.entry.revision === resolved.token.revision
        ? await this.prisma.publicationSchedule.findFirst({
            orderBy: [{ scheduledFor: "asc" }, { id: "asc" }],
            select: { action: true, scheduledFor: true },
            where: {
              contentEntryId: resolved.token.contentEntryId,
              siteId: resolved.token.siteId,
              status: "PENDING",
            },
          })
        : null;
    this.metrics.recordPreviewOperation("redeemed");
    return {
      contentType: resolved.entry.contentType,
      data: locale.data,
      expiresAt: resolved.token.expiresAt.toISOString(),
      id: resolved.token.contentEntryId,
      locale: locale.localeCode,
      revision: resolved.snapshot.revision,
      schemaVersion: resolved.snapshot.schemaVersion,
      scheduledPublication: schedule
        ? { action: schedule.action, scheduledFor: schedule.scheduledFor.toISOString() }
        : null,
      site: resolved.entry.site,
      snapshotAt: resolved.snapshot.createdAt.toISOString(),
      status: resolved.snapshot.status,
    };
  }

  async authorizeAsset(token: string, assetId: string) {
    const resolved = await this.resolveToken(token);
    const locale = resolved.locales.find((item) => item.localeId === resolved.token.localeId);
    if (!locale || !referencesAsset(locale.data, assetId)) {
      this.metrics.recordPreviewOperation("asset_miss");
      throw new ContentPreviewNotFoundError();
    }
    const asset = await this.prisma.asset.findUnique({
      select: { version: true },
      where: { id_siteId: { id: assetId, siteId: resolved.token.siteId } },
    });
    if (!asset) {
      this.metrics.recordPreviewOperation("asset_miss");
      throw new ContentPreviewNotFoundError();
    }
    this.metrics.recordPreviewOperation("asset_read");
    return { siteId: resolved.token.siteId, version: asset.version };
  }

  private parseRequest(input: unknown): PreviewRequest {
    const parsed = previewRequestSchema.safeParse(input);
    if (!parsed.success) throw new InvalidContentPreviewRequestError();
    return parsed.data;
  }

  private async resolveToken(token: string) {
    if (!tokenPattern.test(token)) {
      this.metrics.recordPreviewOperation("redeem_miss");
      throw new ContentPreviewNotFoundError();
    }
    const previewToken = await this.prisma.contentPreviewToken.findFirst({
      select: {
        contentEntryId: true,
        expiresAt: true,
        localeId: true,
        revision: true,
        siteId: true,
      },
      where: {
        expiresAt: { gt: new Date() },
        revokedAt: null,
        tokenHash: tokenHash(token),
      },
    });
    if (!previewToken) {
      this.metrics.recordPreviewOperation("redeem_miss");
      throw new ContentPreviewNotFoundError();
    }

    const snapshot = await this.prisma.contentEntrySnapshot.findUnique({
      select: { createdAt: true, locales: true, revision: true, schemaVersion: true, status: true },
      where: {
        contentEntryId_siteId_revision: {
          contentEntryId: previewToken.contentEntryId,
          revision: previewToken.revision,
          siteId: previewToken.siteId,
        },
      },
    });
    const entry = await this.prisma.contentEntry.findUnique({
      select: {
        contentType: { select: { displayName: true, key: true } },
        revision: true,
        site: { select: { key: true, name: true, status: true } },
      },
      where: { id_siteId: { id: previewToken.contentEntryId, siteId: previewToken.siteId } },
    });
    if (!snapshot || !entry || entry.site.status !== "ACTIVE") {
      this.metrics.recordPreviewOperation("redeem_miss");
      throw new ContentPreviewNotFoundError();
    }
    return {
      entry: {
        contentType: entry.contentType,
        revision: entry.revision,
        site: { key: entry.site.key, name: entry.site.name },
      },
      locales: contentEntrySnapshotLocalesSchema.parse(snapshot.locales),
      snapshot,
      token: previewToken,
    };
  }
}
