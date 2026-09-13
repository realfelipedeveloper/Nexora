import { type ExecutionContext, ForbiddenException, UnauthorizedException } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";
import type { SiteAccessService } from "./site-access.service.js";
import {
  RequireSitePermissions,
  SiteAuthorizationGuard,
  type SiteScopedRequest,
} from "./site-authorization.guard.js";

const siteId = "00000000-0000-4000-8000-000000000001";

class TestController {
  handler() {
    return undefined;
  }
}

function authenticatedRequest(): SiteScopedRequest {
  return {
    headers: {},
    identity: {
      csrfToken: "csrf-token",
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      sessionId: "session-1",
      user: {
        displayName: "Editor",
        email: "editor@example.com",
        id: "user-1",
        isSystemAdmin: false,
      },
    },
    params: { siteId },
  };
}

function executionContext(request: SiteScopedRequest) {
  return {
    getClass: () => TestController,
    getHandler: () => TestController.prototype.handler,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function guardFixture(permissions: string[] | undefined, access: unknown) {
  const reflector = { getAllAndOverride: vi.fn().mockReturnValue(permissions) };
  const service = { resolveSiteAccess: vi.fn().mockResolvedValue(access) };
  const guard = new SiteAuthorizationGuard(
    reflector as unknown as Reflector,
    service as unknown as SiteAccessService,
  );
  return { guard, service };
}

describe("SiteAuthorizationGuard", () => {
  it("attaches the authorized scope to the request", async () => {
    const request = authenticatedRequest();
    const access = {
      isSystemAdmin: false,
      permissionKeys: ["content.read", "site.read"],
      roleKeys: ["viewer"],
      siteId,
    };
    const { guard, service } = guardFixture(["site.read"], access);

    await expect(guard.canActivate(executionContext(request))).resolves.toBe(true);
    expect(request.siteAccess).toBe(access);
    expect(service.resolveSiteAccess).toHaveBeenCalledWith("user-1", false, siteId);
  });

  it("requires an authenticated identity", async () => {
    const request = { headers: {}, params: { siteId } };
    const { guard, service } = guardFixture(["site.read"], undefined);

    await expect(guard.canActivate(executionContext(request))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(service.resolveSiteAccess).not.toHaveBeenCalled();
  });

  it.each([
    ["missing permission metadata", undefined, siteId],
    ["an empty permission requirement", [], siteId],
    ["a missing site id", ["site.read"], undefined],
    ["a malformed site id", ["site.read"], "../other-site"],
  ])("fails closed for %s", async (_case, permissions, requestedSiteId) => {
    const request = authenticatedRequest();
    request.params = { siteId: requestedSiteId };
    const { guard, service } = guardFixture(permissions, undefined);

    await expect(guard.canActivate(executionContext(request))).rejects.toThrow(
      "Site access denied.",
    );
    expect(service.resolveSiteAccess).not.toHaveBeenCalled();
  });

  it("uses the same forbidden response for missing sites and missing permissions", async () => {
    const request = authenticatedRequest();
    const { guard } = guardFixture(["content.publish"], {
      isSystemAdmin: false,
      permissionKeys: ["content.read"],
      roleKeys: ["viewer"],
      siteId,
    });

    await expect(guard.canActivate(executionContext(request))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("rejects an unknown site without revealing whether it exists", async () => {
    const request = authenticatedRequest();
    const { guard } = guardFixture(["site.read"], undefined);

    await expect(guard.canActivate(executionContext(request))).rejects.toMatchObject({
      message: "Site access denied.",
    });
  });

  it("does not allow permission decorators without a requirement", () => {
    expect(() => RequireSitePermissions()).toThrow(TypeError);
  });
});
