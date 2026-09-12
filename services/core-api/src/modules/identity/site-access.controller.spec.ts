import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { SiteAccessController } from "./site-access.controller.js";

describe("SiteAccessController", () => {
  it("returns only the scope established by the authorization guard", () => {
    const controller = new SiteAccessController();
    const siteAccess = {
      isSystemAdmin: false,
      permissionKeys: ["site.read"] as const,
      roleKeys: ["viewer"],
      siteId: "00000000-0000-4000-8000-000000000001",
    };

    expect(controller.currentAccess({ headers: {}, siteAccess })).toBe(siteAccess);
  });

  it("fails closed if the guard did not establish a site scope", () => {
    const controller = new SiteAccessController();

    expect(() => controller.currentAccess({ headers: {} })).toThrow(ForbiddenException);
  });
});
