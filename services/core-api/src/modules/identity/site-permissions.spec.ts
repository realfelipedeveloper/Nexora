import { describe, expect, it } from "vitest";
import { hasSitePermissions, isSitePermission, sitePermissions } from "./site-permissions.js";

describe("site permissions", () => {
  it("recognizes only permissions in the application catalog", () => {
    expect(isSitePermission("content.publish")).toBe(true);
    expect(isSitePermission("content.execute")).toBe(false);
    expect(new Set(sitePermissions).size).toBe(sitePermissions.length);
  });

  it("requires every requested permission", () => {
    const access = {
      isSystemAdmin: false,
      permissionKeys: ["content.read", "content.write"] as const,
      roleKeys: ["editor"],
      siteId: "site-1",
    };

    expect(hasSitePermissions(access, ["content.read", "content.write"])).toBe(true);
    expect(hasSitePermissions(access, ["content.publish"])).toBe(false);
  });
});
