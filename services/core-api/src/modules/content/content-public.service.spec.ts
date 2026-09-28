import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ContentMetrics } from "./content-metrics.js";
import { InvalidPublicContentQueryError, PublicContentService } from "./content-public.service.js";
import type { LocaleManagementService } from "../sites/locale-management.service.js";

const entryId = "10000000-0000-4000-8000-000000000001";
const secondEntryId = "10000000-0000-4000-8000-000000000002";

function fixture() {
  const prisma = {
    contentType: { findFirst: vi.fn() },
    publishedContentEntry: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  };
  const metrics = new ContentMetrics();
  const locales = { resolvePublic: vi.fn() };
  const service = new PublicContentService(
    prisma as unknown as PrismaClient,
    metrics,
    locales as unknown as LocaleManagementService,
  );
  return { locales, metrics, prisma, service };
}

function publicContext(context: ReturnType<typeof fixture>) {
  context.locales.resolvePublic.mockResolvedValue({
    locales: [{ code: "pt-BR", id: "locale-1" }],
    requestedLocale: "pt-BR",
    siteId: "site-1",
  });
  context.prisma.contentType.findFirst.mockResolvedValue({ id: "type-1", key: "article" });
}

function entry(id = entryId, publishedAt = "2026-09-22T15:00:00.000Z") {
  return {
    contentEntry: { assetRelations: [] },
    contentEntryId: id,
    data: { title: "Public article" },
    publishedAt: new Date(publishedAt),
    schemaVersion: 3,
    updatedAt: new Date("2026-09-22T15:01:00.000Z"),
  };
}

describe("PublicContentService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a bounded published projection and an opaque cursor", async () => {
    const context = fixture();
    const { metrics, prisma, service } = context;
    publicContext(context);
    prisma.publishedContentEntry.findMany.mockResolvedValue([
      entry(),
      entry(secondEntryId, "2026-09-22T14:00:00.000Z"),
    ]);

    const page = await service.list("main-site", "article", { limit: "1", locale: "pt-BR" });

    expect(page).toEqual({
      items: [
        {
          assets: [],
          contentType: { key: "article" },
          data: { title: "Public article" },
          id: entryId,
          locale: "pt-BR",
          publishedAt: "2026-09-22T15:00:00.000Z",
          schemaVersion: 3,
          updatedAt: "2026-09-22T15:01:00.000Z",
        },
      ],
      nextCursor: expect.stringMatching(/^[A-Za-z0-9_-]+$/u),
    });
    expect(context.locales.resolvePublic).toHaveBeenCalledWith("main-site", "pt-BR");
    expect(prisma.publishedContentEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ publishedAt: "desc" }, { contentEntryId: "desc" }],
        take: 2,
        where: expect.objectContaining({
          contentTypeKey: "article",
          localeCode: "pt-BR",
          siteId: "site-1",
        }),
      }),
    );
    expect(JSON.stringify(page)).not.toContain("locale-1");
    expect(JSON.stringify(page)).not.toContain("site-1");
    expect(metrics.render()).toContain(
      'nexora_public_content_reads_total{operation="list",outcome="hit"} 1',
    );
  });

  it("projects only versioned assets linked to the requested locale", async () => {
    const context = fixture();
    const { prisma, service } = context;
    publicContext(context);
    prisma.publishedContentEntry.findFirst.mockResolvedValue({
      ...entry(),
      contentEntry: {
        assetRelations: [
          {
            asset: {
              altText: "Nexora newsroom",
              displayName: "newsroom.jpg",
              id: "20000000-0000-4000-8000-000000000001",
              mimeType: "image/jpeg",
              version: 4,
            },
            position: 0,
            role: "cover",
          },
        ],
      },
    });

    await expect(service.get("main-site", "article", entryId, "pt-BR")).resolves.toMatchObject({
      assets: [
        {
          altText: "Nexora newsroom",
          displayName: "newsroom.jpg",
          id: "20000000-0000-4000-8000-000000000001",
          mimeType: "image/jpeg",
          position: 0,
          role: "cover",
          version: 4,
        },
      ],
    });
    expect(prisma.publishedContentEntry.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          contentEntry: expect.objectContaining({
            select: expect.objectContaining({
              assetRelations: expect.objectContaining({ where: { localeId: "locale-1" } }),
            }),
          }),
        }),
      }),
    );
  });

  it("applies the opaque cursor to the publication timestamp and identifier", async () => {
    const context = fixture();
    const { prisma, service } = context;
    publicContext(context);
    prisma.publishedContentEntry.findMany
      .mockResolvedValueOnce([entry(), entry(secondEntryId, "2026-09-22T14:00:00.000Z")])
      .mockResolvedValueOnce([]);
    const firstPage = await service.list("main-site", "article", {
      limit: "1",
      locale: "pt-BR",
    });

    await service.list("main-site", "article", {
      cursor: firstPage?.nextCursor ?? undefined,
      limit: "1",
      locale: "pt-BR",
    });

    expect(prisma.publishedContentEntry.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { publishedAt: { lt: new Date("2026-09-22T15:00:00.000Z") } },
            {
              contentEntryId: { lt: entryId },
              publishedAt: new Date("2026-09-22T15:00:00.000Z"),
            },
          ],
        }),
      }),
    );
  });

  it("returns only a published entry in the resolved site and locale", async () => {
    const context = fixture();
    const { metrics, prisma, service } = context;
    publicContext(context);
    prisma.publishedContentEntry.findFirst.mockResolvedValue(entry());

    await expect(service.get("main-site", "article", entryId, "pt-BR")).resolves.toMatchObject({
      data: { title: "Public article" },
      id: entryId,
    });
    expect(prisma.publishedContentEntry.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          contentEntryId: entryId,
          contentTypeKey: "article",
          localeCode: "pt-BR",
          siteId: "site-1",
        }),
      }),
    );
    expect(metrics.render()).toContain(
      'nexora_public_content_reads_total{operation="detail",outcome="hit"} 1',
    );
  });

  it("falls back to the next configured locale when a translation is absent", async () => {
    const context = fixture();
    const { locales, prisma, service } = context;
    locales.resolvePublic.mockResolvedValue({
      locales: [
        { code: "pt-BR", id: "locale-1" },
        { code: "en-US", id: "locale-2" },
      ],
      requestedLocale: "pt-BR",
      siteId: "site-1",
    });
    prisma.contentType.findFirst.mockResolvedValue({ id: "type-1", key: "article" });
    prisma.publishedContentEntry.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(entry());

    await expect(service.get("main-site", "article", entryId, "pt-BR")).resolves.toMatchObject({
      locale: "en-US",
    });
    expect(prisma.publishedContentEntry.findFirst).toHaveBeenCalledTimes(2);
  });

  it("does not expose content when the public context or published entry is absent", async () => {
    const context = fixture();
    const { locales, metrics, prisma, service } = context;
    locales.resolvePublic.mockResolvedValueOnce(null);
    await expect(service.list("archived-site", "article", { locale: "pt-BR" })).resolves.toBeNull();

    publicContext(context);
    prisma.publishedContentEntry.findFirst.mockResolvedValue(null);
    await expect(service.get("main-site", "article", entryId, "pt-BR")).resolves.toBeNull();
    expect(metrics.render()).toContain(
      'nexora_public_content_reads_total{operation="list",outcome="miss"} 1',
    );
    expect(metrics.render()).toContain(
      'nexora_public_content_reads_total{operation="detail",outcome="miss"} 1',
    );
  });

  it.each([
    ["missing locale", { locale: undefined }],
    ["invalid limit", { limit: "101", locale: "pt-BR" }],
    ["invalid cursor", { cursor: "not-a-valid-cursor", locale: "pt-BR" }],
  ])("rejects an %s", async (_label, query) => {
    const { service } = fixture();
    await expect(service.list("main-site", "article", query)).rejects.toBeInstanceOf(
      InvalidPublicContentQueryError,
    );
  });
});
