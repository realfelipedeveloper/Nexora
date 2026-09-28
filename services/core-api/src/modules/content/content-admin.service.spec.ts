import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { DistributedCacheService } from "../cache/distributed-cache.service.js";
import type { SiteAccess } from "../identity/site-permissions.js";
import { ContentAdminService } from "./content-admin.service.js";
import type { ContentFieldValidator } from "./content-field-validator.js";
import type { ContentMetrics } from "./content-metrics.js";
import { ContentAssetRelationService } from "./content-asset-relation.service.js";

describe("ContentAdminService", () => {
  it("returns default-first locales and active editorial members within the site", async () => {
    const locales = [{ code: "pt-BR", id: "locale-1", isDefault: true }];
    const members = [{ displayName: "Editor", id: "user-1" }];
    const prisma = {
      locale: { findMany: vi.fn().mockResolvedValue(locales) },
      user: { findMany: vi.fn().mockResolvedValue(members) },
    } as unknown as PrismaClient;
    const service = new ContentAdminService(
      prisma,
      {} as ContentFieldValidator,
      {} as ContentMetrics,
      new ContentAssetRelationService(),
      { invalidateSite: vi.fn() } as unknown as DistributedCacheService,
    );

    await expect(service.getEditorialContext("site-1")).resolves.toEqual({ locales, members });
    expect(prisma.locale.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { siteId: "site-1" } }),
    );
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "ACTIVE" }),
      }),
    );
  });

  it("invalidates public cache only after the projection transaction commits", async () => {
    const order: string[] = [];
    const transaction = {
      contentEntry: {
        findUnique: vi.fn().mockResolvedValue({
          id: "entry-1",
          publishedAt: null,
          revision: 3,
          status: "DRAFT",
        }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "entry-1", status: "DRAFT" }),
      },
      publishedContentEntry: {
        deleteMany: vi.fn(async () => {
          order.push("projection");
          return { count: 0 };
        }),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof transaction) => Promise<unknown>) => {
        const result = await callback(transaction);
        order.push("commit");
        return result;
      }),
    } as unknown as PrismaClient;
    const cache = {
      invalidateSite: vi.fn(async () => {
        order.push("invalidate");
      }),
    };
    const service = new ContentAdminService(
      prisma,
      {} as ContentFieldValidator,
      {} as ContentMetrics,
      new ContentAssetRelationService(),
      cache as unknown as DistributedCacheService,
    );
    const access = {
      isSystemAdmin: true,
      permissionKeys: ["content.write"],
      roleKeys: [],
      siteId: "site-1",
    } satisfies SiteAccess;

    await service.updateContentEntryStatus("actor-1", "site-1", access, "entry-1", 3, {
      status: "DRAFT",
    });

    expect(order).toEqual(["projection", "commit", "invalidate"]);
    expect(cache.invalidateSite).toHaveBeenCalledWith("site-1");
  });
});
