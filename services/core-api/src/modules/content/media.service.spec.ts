import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MalwareScanner } from "./malware-scanner.js";
import type { MediaStorage } from "./media-storage.js";
import {
  AssetInUseError,
  AssetNotFoundError,
  AssetPreconditionFailedError,
  InvalidMediaInputError,
  InvalidMediaPageError,
  MediaService,
  UnsupportedAssetTypeError,
} from "./media.service.js";
import type { ContentMetrics } from "./content-metrics.js";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const directories: string[] = [];

async function temporaryFile() {
  const directory = await mkdtemp(join(tmpdir(), "nexora-media-test-"));
  directories.push(directory);
  const filePath = join(directory, "asset");
  await writeFile(filePath, png);
  return filePath;
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

function dependencies() {
  const createdAt = new Date("2026-09-26T12:00:00.000Z");
  const transaction = {
    asset: {
      create: vi.fn().mockImplementation(({ data }) => ({
        ...data,
        _count: { contentRelations: 0 },
        altText: null,
        createdAt,
        site: { key: "public-site" },
        status: "READY",
        updatedAt: createdAt,
        version: 1,
      })),
    },
    auditEvent: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    $transaction: vi.fn().mockImplementation((callback) => callback(transaction)),
  } as unknown as PrismaClient;
  const storage = { delete: vi.fn(), get: vi.fn(), put: vi.fn() } as unknown as MediaStorage;
  const scanner = { scan: vi.fn() } as unknown as MalwareScanner;
  const metrics = { recordMediaOperation: vi.fn() } as unknown as ContentMetrics;
  return { metrics, prisma, scanner, storage, transaction };
}

function selectedAsset(id = "asset-1", version = 1) {
  const createdAt = new Date("2026-09-26T12:00:00.000Z");
  return {
    _count: { contentRelations: 0 },
    altText: null,
    checksumSha256: "a".repeat(64),
    createdAt,
    displayName: "pixel.png",
    extension: "png",
    id,
    mimeType: "image/png",
    originalName: "pixel.png",
    site: { key: "public-site" },
    siteId: "site-1",
    sizeBytes: png.length,
    status: "READY",
    updatedAt: createdAt,
    version,
  } as const;
}

describe("MediaService", () => {
  it("detects, scans, hashes, stores, and audits an allowed upload", async () => {
    const filePath = await temporaryFile();
    const { metrics, prisma, scanner, storage, transaction } = dependencies();
    const service = new MediaService(prisma, storage, scanner, metrics);

    const asset = await service.upload("actor-1", "site-1", {
      cleanup: vi.fn(),
      declaredMimeType: "image/png",
      filePath,
      originalName: "pixel.png",
    });

    expect(scanner.scan).toHaveBeenCalledWith(filePath);
    expect(storage.put).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: "image/png", filePath, sizeBytes: png.length }),
    );
    expect(transaction.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "media.asset.created" }) }),
    );
    expect(asset).toMatchObject({ displayName: "pixel.png", mimeType: "image/png", usageCount: 0 });
    expect(asset.contentUrl).toContain("/sites/site-1/assets/");
  });

  it("rejects a declared MIME that disagrees with the file signature", async () => {
    const filePath = await temporaryFile();
    const { metrics, prisma, scanner, storage } = dependencies();
    const service = new MediaService(prisma, storage, scanner, metrics);

    await expect(
      service.upload("actor-1", "site-1", {
        cleanup: vi.fn(),
        declaredMimeType: "application/pdf",
        filePath,
        originalName: "disguised.pdf",
      }),
    ).rejects.toBeInstanceOf(UnsupportedAssetTypeError);
    expect(scanner.scan).not.toHaveBeenCalled();
    expect(storage.put).not.toHaveBeenCalled();
  });

  it("serves public bytes only when an asset is linked to a published locale projection", async () => {
    const { metrics, scanner, storage } = dependencies();
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        ...selectedAsset(),
        contentRelations: [
          {
            contentEntry: { publishedProjections: [{ localeId: "locale-published" }] },
            localeId: "locale-draft",
          },
        ],
      });
    const prisma = { asset: { findFirst } } as unknown as PrismaClient;
    const service = new MediaService(prisma, storage, scanner, metrics);

    await expect(service.readBySiteKey("public-site", "asset-1", 1)).rejects.toBeInstanceOf(
      AssetNotFoundError,
    );
    await expect(service.readBySiteKey("public-site", "asset-1", 1)).rejects.toBeInstanceOf(
      AssetNotFoundError,
    );
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          contentRelations: expect.objectContaining({
            where: { contentEntry: { publishedProjections: { some: {} } } },
          }),
        }),
      }),
    );
    expect(storage.get).not.toHaveBeenCalled();
  });

  it("lists bounded searchable pages and validates site-scoped cursors", async () => {
    const { metrics, scanner, storage } = dependencies();
    const asset = {
      findFirst: vi.fn().mockResolvedValue({ id: "asset-0" }),
      findMany: vi.fn().mockResolvedValue([selectedAsset("asset-1"), selectedAsset("asset-2")]),
    };
    const service = new MediaService(
      { asset } as unknown as PrismaClient,
      storage,
      scanner,
      metrics,
    );

    await expect(
      service.list("site-1", { cursor: "asset-0", limit: "1", query: " pixel " }),
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ id: "asset-1" })],
      nextCursor: "asset-1",
    });
    expect(asset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { id: "asset-0" },
        skip: 1,
        take: 2,
        where: expect.objectContaining({ siteId: "site-1" }),
      }),
    );

    asset.findFirst.mockResolvedValueOnce(null);
    await expect(service.list("site-1", { cursor: "foreign" })).rejects.toBeInstanceOf(
      InvalidMediaPageError,
    );
  });

  it.each([{ limit: "0" }, { limit: "101" }, { limit: "1.5" }, { query: "x".repeat(121) }])(
    "rejects invalid media page input %#",
    async (input) => {
      const { metrics, scanner, storage } = dependencies();
      const service = new MediaService(
        { asset: {} } as unknown as PrismaClient,
        storage,
        scanner,
        metrics,
      );
      await expect(service.list("site-1", input)).rejects.toBeInstanceOf(InvalidMediaPageError);
    },
  );

  it("reads metadata and private bytes only within the requested site", async () => {
    const { metrics, scanner, storage } = dependencies();
    const assetRecord = {
      ...selectedAsset(),
      contentRelations: [
        {
          contentEntry: { publishedProjections: [{ localeId: "locale-1" }] },
          localeId: "locale-1",
        },
      ],
    };
    const storedObject = { body: { on: vi.fn(), pipe: vi.fn() } };
    vi.mocked(storage.get).mockResolvedValue(storedObject as never);
    const asset = {
      findFirst: vi.fn().mockResolvedValue(assetRecord),
      findUnique: vi.fn().mockResolvedValue(assetRecord),
    };
    const service = new MediaService(
      { asset } as unknown as PrismaClient,
      storage,
      scanner,
      metrics,
    );

    await expect(service.get("site-1", "asset-1")).resolves.toMatchObject({ id: "asset-1" });
    await expect(service.readBySiteId("site-1", "asset-1", 1)).resolves.toMatchObject({
      object: storedObject,
    });
    await expect(service.readBySiteKey("public-site", "asset-1", 1)).resolves.toMatchObject({
      object: storedObject,
    });
    expect(storage.get).toHaveBeenCalledTimes(2);

    asset.findUnique.mockResolvedValueOnce(null);
    await expect(service.get("site-1", "missing")).rejects.toBeInstanceOf(AssetNotFoundError);
    asset.findFirst.mockResolvedValueOnce(null);
    await expect(service.readBySiteId("site-1", "missing", 1)).rejects.toBeInstanceOf(
      AssetNotFoundError,
    );
  });

  it("updates metadata with optimistic concurrency and an audit event", async () => {
    const { metrics, scanner, storage } = dependencies();
    const transaction = {
      asset: {
        findUnique: vi.fn().mockResolvedValue({ version: 2 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue(selectedAsset("asset-1", 3)),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn((operation) => operation(transaction)),
    } as unknown as PrismaClient;
    const service = new MediaService(prisma, storage, scanner, metrics);

    await expect(
      service.update("actor", "site-1", "asset-1", 2, {
        altText: " Pixel ",
        displayName: " Updated image ",
      }),
    ).resolves.toMatchObject({ displayName: "pixel.png", version: 3 });
    expect(transaction.asset.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { altText: "Pixel", displayName: "Updated image", version: { increment: 1 } },
      }),
    );
    expect(transaction.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "media.asset.updated" }) }),
    );

    transaction.asset.findUnique.mockResolvedValueOnce({ version: 4 });
    await expect(
      service.update("actor", "site-1", "asset-1", 2, { displayName: "Updated" }),
    ).rejects.toBeInstanceOf(AssetPreconditionFailedError);
  });

  it.each([null, [], {}, { displayName: "" }, { displayName: "x", altText: 2 }])(
    "rejects invalid metadata %#",
    async (input) => {
      const { metrics, prisma, scanner, storage } = dependencies();
      const service = new MediaService(prisma, storage, scanner, metrics);
      await expect(service.update("actor", "site", "asset", 1, input)).rejects.toBeInstanceOf(
        InvalidMediaInputError,
      );
    },
  );

  it("deletes unused assets transactionally and reports relation races", async () => {
    const { metrics, scanner, storage } = dependencies();
    const transaction = {
      asset: {
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue({
          _count: { contentRelations: 0 },
          storageKey: "site-1/asset.png",
          version: 2,
        }),
      },
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn((operation) => operation(transaction)),
    } as unknown as PrismaClient;
    const service = new MediaService(prisma, storage, scanner, metrics);

    await expect(service.delete("actor", "site-1", "asset-1", 2)).resolves.toBeUndefined();
    expect(storage.delete).toHaveBeenCalledWith("site-1/asset.png");
    expect(transaction.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "media.asset.deleted" }) }),
    );

    vi.mocked(prisma.$transaction).mockRejectedValueOnce({ code: "P2003" });
    await expect(service.delete("actor", "site-1", "asset-1", 2)).rejects.toBeInstanceOf(
      AssetInUseError,
    );
  });

  it("lists bounded usage only for an existing site asset", async () => {
    const { metrics, scanner, storage } = dependencies();
    const contentAssetRelation = { findMany: vi.fn().mockResolvedValue([{ id: "relation" }]) };
    const asset = { findUnique: vi.fn().mockResolvedValue({ id: "asset-1" }) };
    const service = new MediaService(
      { asset, contentAssetRelation } as unknown as PrismaClient,
      storage,
      scanner,
      metrics,
    );
    await expect(service.usage("site-1", "asset-1")).resolves.toEqual([{ id: "relation" }]);
    expect(contentAssetRelation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100, where: { assetId: "asset-1", siteId: "site-1" } }),
    );
    asset.findUnique.mockResolvedValueOnce(null);
    await expect(service.usage("site-1", "missing")).rejects.toBeInstanceOf(AssetNotFoundError);
  });
});
