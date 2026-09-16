import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { ConfigurationRegistry } from "./configuration-registry.js";
import { PublicConfigurationService } from "./public-configuration.service.js";

function prismaFixture() {
  return {
    globalSetting: { findMany: vi.fn() },
    site: { findFirst: vi.fn() },
  } as unknown as PrismaClient;
}

describe("PublicConfigurationService", () => {
  it("returns only the explicitly permitted projection for an active site", async () => {
    const prisma = prismaFixture();
    vi.mocked(prisma.site.findFirst).mockResolvedValue({
      key: "main-site",
      settings: [
        {
          key: "site.identity",
          value: { description: "  A public site.  ", displayName: "  Main Site  " },
        },
      ],
    } as never);
    vi.mocked(prisma.globalSetting.findMany).mockResolvedValue([
      { key: "platform.branding", value: { productName: "  Nexora  " } },
    ] as never);
    const service = new PublicConfigurationService(prisma, new ConfigurationRegistry());

    await expect(service.getSiteConfiguration("main-site")).resolves.toEqual({
      branding: { productName: "Nexora" },
      site: {
        identity: { description: "A public site.", displayName: "Main Site" },
        key: "main-site",
      },
    });
    expect(prisma.site.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "main-site", status: "ACTIVE" },
      }),
    );
  });

  it("does not expose configuration when the requested site is not active", async () => {
    const prisma = prismaFixture();
    vi.mocked(prisma.site.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.globalSetting.findMany).mockResolvedValue([]);
    const service = new PublicConfigurationService(prisma, new ConfigurationRegistry());

    await expect(service.getSiteConfiguration("archived-site")).resolves.toBeNull();
  });
});
