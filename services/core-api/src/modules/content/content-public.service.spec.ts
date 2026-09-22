import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ContentMetrics } from "./content-metrics.js";
import { InvalidPublicContentQueryError, PublicContentService } from "./content-public.service.js";

const entryId = "10000000-0000-4000-8000-000000000001";
const secondEntryId = "10000000-0000-4000-8000-000000000002";

function fixture() {
  const prisma = {
    contentEntry: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    site: { findFirst: vi.fn() },
  };
  const metrics = new ContentMetrics();
  const service = new PublicContentService(prisma as unknown as PrismaClient, metrics);
  return { metrics, prisma, service };
}

function publicContext(prisma: ReturnType<typeof fixture>["prisma"]) {
  prisma.site.findFirst.mockResolvedValue({
    contentTypes: [{ id: "type-1", key: "article" }],
    id: "site-1",
    locales: [{ code: "pt-BR", id: "locale-1" }],
  });
}

function entry(id = entryId, publishedAt = "2026-09-22T15:00:00.000Z") {
  return {
    contentLocales: [{ data: { title: "Public article" } }],
    id,
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
    const { metrics, prisma, service } = fixture();
    publicContext(prisma);
    prisma.contentEntry.findMany.mockResolvedValue([
      entry(),
      entry(secondEntryId, "2026-09-22T14:00:00.000Z"),
    ]);

    const page = await service.list("main-site", "article", { limit: "1", locale: "pt-BR" });

    expect(page).toEqual({
      items: [
        {
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
    expect(prisma.site.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: "main-site", status: "ACTIVE" } }),
    );
    expect(prisma.contentEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
        take: 2,
        where: expect.objectContaining({
          contentTypeId: "type-1",
          publishedAt: { not: null },
          siteId: "site-1",
          status: "PUBLISHED",
        }),
      }),
    );
    expect(JSON.stringify(page)).not.toContain("locale-1");
    expect(JSON.stringify(page)).not.toContain("site-1");
    expect(metrics.render()).toContain(
      'nexora_public_content_reads_total{operation="list",outcome="hit"} 1',
    );
  });

  it("applies the opaque cursor to the publication timestamp and identifier", async () => {
    const { prisma, service } = fixture();
    publicContext(prisma);
    prisma.contentEntry.findMany
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

    expect(prisma.contentEntry.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { publishedAt: { lt: new Date("2026-09-22T15:00:00.000Z") } },
            { id: { lt: entryId }, publishedAt: new Date("2026-09-22T15:00:00.000Z") },
          ],
        }),
      }),
    );
  });

  it("returns only a published entry in the resolved site and locale", async () => {
    const { metrics, prisma, service } = fixture();
    publicContext(prisma);
    prisma.contentEntry.findFirst.mockResolvedValue(entry());

    await expect(service.get("main-site", "article", entryId, "pt-BR")).resolves.toMatchObject({
      data: { title: "Public article" },
      id: entryId,
    });
    expect(prisma.contentEntry.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          contentTypeId: "type-1",
          id: entryId,
          siteId: "site-1",
          status: "PUBLISHED",
        }),
      }),
    );
    expect(metrics.render()).toContain(
      'nexora_public_content_reads_total{operation="detail",outcome="hit"} 1',
    );
  });

  it("does not expose content when the public context or published entry is absent", async () => {
    const { metrics, prisma, service } = fixture();
    prisma.site.findFirst.mockResolvedValueOnce(null);
    await expect(service.list("archived-site", "article", { locale: "pt-BR" })).resolves.toBeNull();

    publicContext(prisma);
    prisma.contentEntry.findFirst.mockResolvedValue(null);
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
