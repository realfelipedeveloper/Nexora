import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { ContentAdminService } from "./content-admin.service.js";
import type { ContentFieldValidator } from "./content-field-validator.js";
import type { ContentMetrics } from "./content-metrics.js";

describe("ContentAdminService editorial context", () => {
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
});
