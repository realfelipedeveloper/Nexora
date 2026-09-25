import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { SectionAccessService } from "./section-access.service.js";
import type { SiteAccessService } from "./site-access.service.js";

function fixture() {
  const prisma = {
    section: { findUnique: vi.fn() },
    sectionRoleAssignment: { findMany: vi.fn() },
  };
  const siteAccess = { resolveSiteAccess: vi.fn() };
  const service = new SectionAccessService(
    prisma as unknown as PrismaClient,
    siteAccess as unknown as SiteAccessService,
  );
  return { prisma, service, siteAccess };
}

describe("section access service", () => {
  it("fails closed when the section does not belong to the requested site", async () => {
    const { prisma, service, siteAccess } = fixture();
    prisma.section.findUnique.mockResolvedValue(null);

    await expect(
      service.resolveSectionAccess("user-1", false, "site-1", "section-1"),
    ).resolves.toBeUndefined();
    expect(siteAccess.resolveSiteAccess).not.toHaveBeenCalled();
  });

  it("preserves unrestricted site access for a section", async () => {
    const { prisma, service, siteAccess } = fixture();
    prisma.section.findUnique.mockResolvedValue({ id: "section-1" });
    siteAccess.resolveSiteAccess.mockResolvedValue({
      isSystemAdmin: false,
      permissionKeys: ["content.read", "content.write"],
      roleKeys: ["editor"],
      siteId: "site-1",
    });

    await expect(
      service.resolveSectionAccess("user-1", false, "site-1", "section-1"),
    ).resolves.toMatchObject({
      permissionKeys: ["content.read", "content.write"],
      scope: "SITE",
      sectionId: "section-1",
    });
  });

  it("combines only exact section role permissions", async () => {
    const { prisma, service, siteAccess } = fixture();
    prisma.section.findUnique.mockResolvedValue({ id: "section-1" });
    siteAccess.resolveSiteAccess.mockResolvedValue(undefined);
    prisma.sectionRoleAssignment.findMany.mockResolvedValue([
      {
        role: {
          key: "editor",
          permissions: [
            { permissionKey: "content.write" },
            { permissionKey: "content.read" },
            { permissionKey: "unknown.permission" },
          ],
        },
      },
    ]);

    await expect(
      service.resolveSectionAccess("user-1", false, "site-1", "section-1"),
    ).resolves.toEqual({
      isSystemAdmin: false,
      permissionKeys: ["content.read", "content.write"],
      roleKeys: ["editor"],
      scope: "SECTION",
      sectionId: "section-1",
      siteId: "site-1",
    });
    expect(prisma.sectionRoleAssignment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sectionId: "section-1", siteId: "site-1", userId: "user-1" },
      }),
    );
  });
});
