import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { SiteAccessService } from "./site-access.service.js";
import { sitePermissions } from "./site-permissions.js";

function prismaMock() {
  return {
    site: { findUnique: vi.fn() },
    siteRoleAssignment: { findMany: vi.fn() },
  };
}

describe("SiteAccessService", () => {
  it("grants every site permission to a system administrator for an existing site", async () => {
    const prisma = prismaMock();
    prisma.site.findUnique.mockResolvedValue({ id: "site-1" });
    const service = new SiteAccessService(prisma as unknown as PrismaClient);

    await expect(service.resolveSiteAccess("admin-1", true, "site-1")).resolves.toEqual({
      isSystemAdmin: true,
      permissionKeys: sitePermissions,
      roleKeys: [],
      siteId: "site-1",
    });
    expect(prisma.siteRoleAssignment.findMany).not.toHaveBeenCalled();
  });

  it("does not invent access to a missing site for a system administrator", async () => {
    const prisma = prismaMock();
    prisma.site.findUnique.mockResolvedValue(null);
    const service = new SiteAccessService(prisma as unknown as PrismaClient);

    await expect(
      service.resolveSiteAccess("admin-1", true, "missing-site"),
    ).resolves.toBeUndefined();
  });

  it("combines permissions from every role assigned within the requested site", async () => {
    const prisma = prismaMock();
    prisma.siteRoleAssignment.findMany.mockResolvedValue([
      {
        role: {
          key: "editor",
          permissions: [
            { permissionKey: "site.read" },
            { permissionKey: "content.read" },
            { permissionKey: "content.write" },
            { permissionKey: "future.permission" },
          ],
        },
      },
      {
        role: {
          key: "publisher",
          permissions: [{ permissionKey: "site.read" }, { permissionKey: "content.publish" }],
        },
      },
    ]);
    const service = new SiteAccessService(prisma as unknown as PrismaClient);

    await expect(service.resolveSiteAccess("user-1", false, "site-1")).resolves.toEqual({
      isSystemAdmin: false,
      permissionKeys: ["content.publish", "content.read", "content.write", "site.read"],
      roleKeys: ["editor", "publisher"],
      siteId: "site-1",
    });
    expect(prisma.siteRoleAssignment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { siteId: "site-1", userId: "user-1" } }),
    );
  });

  it("denies users without an assignment in the requested site", async () => {
    const prisma = prismaMock();
    prisma.siteRoleAssignment.findMany.mockResolvedValue([]);
    const service = new SiteAccessService(prisma as unknown as PrismaClient);

    await expect(service.resolveSiteAccess("user-1", false, "site-2")).resolves.toBeUndefined();
  });
});
