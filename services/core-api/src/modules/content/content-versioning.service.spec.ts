import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { ContentEntryNotFoundError } from "./content-admin.service.js";
import type { ContentMetrics } from "./content-metrics.js";
import { ContentVersioningService } from "./content-versioning.service.js";

describe("ContentVersioningService revision listing", () => {
  it("returns bounded newest-first metadata for an entry in the site", async () => {
    const revisions = [{ revision: 3 }, { revision: 2 }];
    const prisma = {
      contentEntry: { findUnique: vi.fn().mockResolvedValue({ id: "entry-1" }) },
      contentEntrySnapshot: { findMany: vi.fn().mockResolvedValue(revisions) },
    } as unknown as PrismaClient;
    const service = new ContentVersioningService(prisma, {} as ContentMetrics);

    await expect(service.listRevisions("site-1", "entry-1")).resolves.toBe(revisions);
    expect(prisma.contentEntrySnapshot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { revision: "desc" },
        take: 100,
        where: { contentEntryId: "entry-1", siteId: "site-1" },
      }),
    );
  });

  it("does not expose revisions for an entry outside the site", async () => {
    const prisma = {
      contentEntry: { findUnique: vi.fn().mockResolvedValue(null) },
      contentEntrySnapshot: { findMany: vi.fn() },
    } as unknown as PrismaClient;
    const service = new ContentVersioningService(prisma, {} as ContentMetrics);

    await expect(service.listRevisions("site-1", "entry-1")).rejects.toBeInstanceOf(
      ContentEntryNotFoundError,
    );
    expect(prisma.contentEntrySnapshot.findMany).not.toHaveBeenCalled();
  });
});
