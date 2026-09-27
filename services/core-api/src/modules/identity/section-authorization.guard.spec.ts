import { ForbiddenException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { SectionAccessService } from "./section-access.service.js";
import {
  RequireSectionPermissions,
  SectionAuthorizationGuard,
  type SectionScopedRequest,
} from "./section-authorization.guard.js";

const siteId = "a11f740b-f15f-4279-8ca2-3877a4cae775";
const sectionId = "2ec3cb32-e8c8-4c64-ad0f-8689e39a06a6";

function request(): SectionScopedRequest {
  return {
    headers: {},
    identity: {
      csrfToken: "csrf",
      expiresAt: new Date("2026-01-01T00:00:00Z"),
      sessionId: "session-1",
      user: {
        displayName: "Editor",
        email: "editor@example.com",
        id: "user-1",
        isSystemAdmin: false,
      },
    },
    params: { sectionId, siteId },
  };
}

function context(scopedRequest: SectionScopedRequest) {
  return {
    getClass: vi.fn(),
    getHandler: vi.fn(),
    switchToHttp: () => ({ getRequest: () => scopedRequest }),
  } as unknown as ExecutionContext;
}

describe("section authorization guard", () => {
  it("attaches access when every required permission is granted", async () => {
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(["content.write"]) };
    const access = {
      resolveSectionAccess: vi.fn().mockResolvedValue({
        isSystemAdmin: false,
        permissionKeys: ["content.read", "content.write"],
        roleKeys: ["editor"],
        scope: "SECTION",
        sectionId,
        siteId,
      }),
    };
    const scopedRequest = request();
    const guard = new SectionAuthorizationGuard(
      reflector as never,
      access as unknown as SectionAccessService,
    );

    await expect(guard.canActivate(context(scopedRequest))).resolves.toBe(true);
    expect(scopedRequest.sectionAccess).toMatchObject({ scope: "SECTION", sectionId });
  });

  it("fails closed for missing permission or invalid scope identifiers", async () => {
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(["content.write"]) };
    const access = {
      resolveSectionAccess: vi.fn().mockResolvedValue({ permissionKeys: ["content.read"] }),
    };
    const guard = new SectionAuthorizationGuard(
      reflector as never,
      access as unknown as SectionAccessService,
    );

    await expect(guard.canActivate(context(request()))).rejects.toBeInstanceOf(ForbiddenException);
    const invalid = request();
    invalid.params = { sectionId: "wrong", siteId };
    await expect(guard.canActivate(context(invalid))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("does not allow permission decorators without a requirement", () => {
    expect(() => RequireSectionPermissions()).toThrow(TypeError);
  });
});
