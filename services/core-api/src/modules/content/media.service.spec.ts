import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MalwareScanner } from "./malware-scanner.js";
import type { MediaStorage } from "./media-storage.js";
import { AssetNotFoundError, MediaService, UnsupportedAssetTypeError } from "./media.service.js";
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

  it("serves public bytes only when an asset belongs to published content", async () => {
    const { metrics, scanner, storage } = dependencies();
    const findFirst = vi.fn().mockResolvedValue(null);
    const prisma = { asset: { findFirst } } as unknown as PrismaClient;
    const service = new MediaService(prisma, storage, scanner, metrics);

    await expect(service.readBySiteKey("public-site", "asset-1", 1)).rejects.toBeInstanceOf(
      AssetNotFoundError,
    );
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          contentRelations: { some: { contentEntry: { status: "PUBLISHED" } } },
        }),
      }),
    );
    expect(storage.get).not.toHaveBeenCalled();
  });
});
