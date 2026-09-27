import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Inject, Injectable } from "@nestjs/common";
import { fileTypeFromFile } from "file-type";
import type { Prisma, PrismaClient } from "@prisma/client";
import { InjectPrismaClient } from "../../database/database.module.js";
import { MALWARE_SCANNER, type MalwareScanner } from "./malware-scanner.js";
import { MEDIA_STORAGE, type MediaObject, type MediaStorage } from "./media-storage.js";
import { maximumAssetBytes, type ReceivedUpload } from "./media-upload.js";
import { ContentMetrics } from "./content-metrics.js";

const allowedMimeTypes = new Set([
  "application/pdf",
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const maximumPageSize = 100;

const assetSelection = {
  _count: { select: { contentRelations: true } },
  altText: true,
  checksumSha256: true,
  createdAt: true,
  displayName: true,
  extension: true,
  id: true,
  mimeType: true,
  originalName: true,
  siteId: true,
  site: { select: { key: true } },
  sizeBytes: true,
  status: true,
  updatedAt: true,
  version: true,
} satisfies Prisma.AssetSelect;

type SelectedAsset = Prisma.AssetGetPayload<{ select: typeof assetSelection }>;

export type MediaPageInput = { cursor?: string; limit?: string; query?: string };

export class InvalidMediaInputError extends Error {
  override readonly name = "InvalidMediaInputError";
}

export class InvalidMediaPageError extends Error {
  override readonly name = "InvalidMediaPageError";
}

export class AssetNotFoundError extends Error {
  override readonly name = "AssetNotFoundError";
}

export class AssetPreconditionFailedError extends Error {
  override readonly name = "AssetPreconditionFailedError";
}

export class AssetInUseError extends Error {
  override readonly name = "AssetInUseError";
}

export class UnsupportedAssetTypeError extends Error {
  override readonly name = "UnsupportedAssetTypeError";
}

function parsePage(input: MediaPageInput) {
  const limit = input.limit === undefined ? 30 : Number(input.limit);
  const query = input.query?.trim();
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > maximumPageSize ||
    (query?.length ?? 0) > 120
  ) {
    throw new InvalidMediaPageError();
  }
  return { cursor: input.cursor, limit, query: query || undefined };
}

function parseMetadata(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new InvalidMediaInputError();
  const { altText, displayName } = input as Record<string, unknown>;
  if (
    typeof displayName !== "string" ||
    displayName.trim().length < 1 ||
    Array.from(displayName.trim()).length > 255 ||
    (altText !== undefined && altText !== null && typeof altText !== "string") ||
    (typeof altText === "string" && Array.from(altText.trim()).length > 500)
  ) {
    throw new InvalidMediaInputError();
  }
  return {
    altText: typeof altText === "string" ? altText.trim() || null : null,
    displayName: displayName.trim(),
  };
}

function dto(asset: SelectedAsset) {
  return {
    altText: asset.altText,
    checksumSha256: asset.checksumSha256,
    contentUrl: `/api/core/sites/${asset.siteId}/assets/${asset.id}/content?v=${asset.version}`,
    createdAt: asset.createdAt,
    displayName: asset.displayName,
    extension: asset.extension,
    id: asset.id,
    mimeType: asset.mimeType,
    originalName: asset.originalName,
    sizeBytes: asset.sizeBytes,
    status: asset.status,
    updatedAt: asset.updatedAt,
    usageCount: asset._count.contentRelations,
    version: asset.version,
  };
}

async function sha256(filePath: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

function isPrismaCode(error: unknown, code: string) {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

@Injectable()
export class MediaService {
  constructor(
    @InjectPrismaClient() private readonly prisma: PrismaClient,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage,
    @Inject(MALWARE_SCANNER) private readonly scanner: MalwareScanner,
    @Inject(ContentMetrics) private readonly metrics: ContentMetrics,
  ) {}

  async list(siteId: string, input: MediaPageInput) {
    const page = parsePage(input);
    const scope = {
      ...(page.query
        ? {
            OR: [
              { displayName: { contains: page.query, mode: "insensitive" as const } },
              { originalName: { contains: page.query, mode: "insensitive" as const } },
            ],
          }
        : {}),
      siteId,
    };
    if (page.cursor) {
      const cursor = await this.prisma.asset.findFirst({
        select: { id: true },
        where: { id: page.cursor, siteId },
      });
      if (!cursor) throw new InvalidMediaPageError();
    }
    const records = await this.prisma.asset.findMany({
      cursor: page.cursor ? { id: page.cursor } : undefined,
      orderBy: { id: "asc" },
      select: assetSelection,
      skip: page.cursor ? 1 : 0,
      take: page.limit + 1,
      where: scope,
    });
    const hasNextPage = records.length > page.limit;
    const items = (hasNextPage ? records.slice(0, page.limit) : records).map(dto);
    return { items, nextCursor: hasNextPage ? items.at(-1)?.id : undefined };
  }

  async get(siteId: string, assetId: string) {
    const asset = await this.prisma.asset.findUnique({
      select: assetSelection,
      where: { id_siteId: { id: assetId, siteId } },
    });
    if (!asset) throw new AssetNotFoundError();
    return dto(asset);
  }

  async upload(actorId: string, siteId: string, upload: ReceivedUpload) {
    const file = await stat(upload.filePath);
    if (!file.isFile() || file.size < 1 || file.size > maximumAssetBytes) {
      throw new InvalidMediaInputError();
    }
    const detected = await fileTypeFromFile(upload.filePath);
    if (!detected || !allowedMimeTypes.has(detected.mime)) {
      this.metrics.recordMediaOperation("rejected");
      throw new UnsupportedAssetTypeError();
    }
    if (
      upload.declaredMimeType &&
      upload.declaredMimeType !== "application/octet-stream" &&
      upload.declaredMimeType !== detected.mime
    ) {
      this.metrics.recordMediaOperation("rejected");
      throw new UnsupportedAssetTypeError();
    }
    try {
      await this.scanner.scan(upload.filePath);
    } catch (error) {
      this.metrics.recordMediaOperation("rejected");
      throw error;
    }
    const checksumSha256 = await sha256(upload.filePath);
    const id = randomUUID();
    const storageKey = `${siteId}/${id}/${checksumSha256}.${detected.ext}`;
    await this.storage.put({
      checksumSha256,
      contentType: detected.mime,
      filePath: upload.filePath,
      sizeBytes: file.size,
      storageKey,
    });

    try {
      const asset = await this.prisma.$transaction(async (transaction) => {
        const created = await transaction.asset.create({
          data: {
            checksumSha256,
            createdById: actorId,
            displayName: upload.originalName,
            extension: detected.ext,
            id,
            mimeType: detected.mime,
            originalName: upload.originalName,
            siteId,
            sizeBytes: file.size,
            storageKey,
          },
          select: assetSelection,
        });
        await transaction.auditEvent.create({
          data: {
            action: "media.asset.created",
            actorId,
            entity: "Asset",
            entityId: id,
            metadata: { checksumSha256, mimeType: detected.mime, siteId, sizeBytes: file.size },
          },
        });
        return created;
      });
      this.metrics.recordMediaOperation("uploaded");
      return dto(asset);
    } catch (error) {
      await this.storage.delete(storageKey).catch(() => undefined);
      throw error;
    }
  }

  async update(
    actorId: string,
    siteId: string,
    assetId: string,
    expectedVersion: number,
    input: unknown,
  ) {
    const command = parseMetadata(input);
    const asset = await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.asset.findUnique({
        select: { version: true },
        where: { id_siteId: { id: assetId, siteId } },
      });
      if (!current) throw new AssetNotFoundError();
      if (current.version !== expectedVersion) throw new AssetPreconditionFailedError();
      const changed = await transaction.asset.updateMany({
        data: { ...command, version: { increment: 1 } },
        where: { id: assetId, siteId, version: expectedVersion },
      });
      if (changed.count !== 1) throw new AssetPreconditionFailedError();
      const asset = await transaction.asset.findUniqueOrThrow({
        select: assetSelection,
        where: { id_siteId: { id: assetId, siteId } },
      });
      await transaction.auditEvent.create({
        data: {
          action: "media.asset.updated",
          actorId,
          entity: "Asset",
          entityId: assetId,
          metadata: { previousVersion: expectedVersion, siteId, version: asset.version },
        },
      });
      return dto(asset);
    });
    this.metrics.recordMediaOperation("updated");
    return asset;
  }

  async delete(actorId: string, siteId: string, assetId: string, expectedVersion: number) {
    let storageKey = "";
    try {
      await this.prisma.$transaction(async (transaction) => {
        const current = await transaction.asset.findUnique({
          select: {
            storageKey: true,
            version: true,
            _count: { select: { contentRelations: true } },
          },
          where: { id_siteId: { id: assetId, siteId } },
        });
        if (!current) throw new AssetNotFoundError();
        if (current.version !== expectedVersion) throw new AssetPreconditionFailedError();
        if (current._count.contentRelations > 0) throw new AssetInUseError();
        const deleted = await transaction.asset.deleteMany({
          where: { id: assetId, siteId, version: expectedVersion },
        });
        if (deleted.count !== 1) throw new AssetPreconditionFailedError();
        storageKey = current.storageKey;
        await transaction.auditEvent.create({
          data: {
            action: "media.asset.deleted",
            actorId,
            entity: "Asset",
            entityId: assetId,
            metadata: { siteId, version: expectedVersion },
          },
        });
      });
    } catch (error) {
      if (isPrismaCode(error, "P2003")) throw new AssetInUseError();
      throw error;
    }
    await this.storage.delete(storageKey);
    this.metrics.recordMediaOperation("deleted");
  }

  async usage(siteId: string, assetId: string) {
    const exists = await this.prisma.asset.findUnique({
      select: { id: true },
      where: { id_siteId: { id: assetId, siteId } },
    });
    if (!exists) throw new AssetNotFoundError();
    return this.prisma.contentAssetRelation.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        contentEntry: {
          select: { contentType: { select: { displayName: true } }, id: true, status: true },
        },
        description: true,
        id: true,
        locale: { select: { code: true } },
        position: true,
        role: true,
        title: true,
      },
      take: 100,
      where: { assetId, siteId },
    });
  }

  async readBySiteKey(
    siteKey: string,
    assetId: string,
    version: number,
  ): Promise<{
    asset: { checksumSha256: string; displayName: string; mimeType: string; sizeBytes: number };
    object: MediaObject;
  }> {
    const asset = await this.prisma.asset.findFirst({
      select: {
        checksumSha256: true,
        contentRelations: {
          select: {
            contentEntry: {
              select: {
                publishedProjections: { select: { localeId: true } },
              },
            },
            localeId: true,
          },
          where: { contentEntry: { publishedProjections: { some: {} } } },
        },
        displayName: true,
        mimeType: true,
        sizeBytes: true,
        storageKey: true,
      },
      where: {
        id: assetId,
        site: { key: siteKey },
        status: "READY",
        version,
      },
    });
    const isPublished = asset?.contentRelations.some((relation) =>
      relation.contentEntry.publishedProjections.some(
        (projection) => projection.localeId === relation.localeId,
      ),
    );
    if (!asset || !isPublished) throw new AssetNotFoundError();
    const object = await this.storage.get(asset.storageKey);
    this.metrics.recordMediaOperation("downloaded");
    return {
      asset: {
        checksumSha256: asset.checksumSha256,
        displayName: asset.displayName,
        mimeType: asset.mimeType,
        sizeBytes: asset.sizeBytes,
      },
      object,
    };
  }

  async readBySiteId(
    siteId: string,
    assetId: string,
    version: number,
  ): Promise<{
    asset: { checksumSha256: string; displayName: string; mimeType: string; sizeBytes: number };
    object: MediaObject;
  }> {
    const asset = await this.prisma.asset.findFirst({
      select: {
        checksumSha256: true,
        displayName: true,
        mimeType: true,
        sizeBytes: true,
        storageKey: true,
      },
      where: { id: assetId, siteId, status: "READY", version },
    });
    if (!asset) throw new AssetNotFoundError();
    const object = await this.storage.get(asset.storageKey);
    this.metrics.recordMediaOperation("downloaded");
    return { asset, object };
  }
}
