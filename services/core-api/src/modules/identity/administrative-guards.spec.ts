import { type ExecutionContext, ForbiddenException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { deriveCsrfToken, sessionCookieName } from "./session-security.js";
import { SessionCsrfGuard, SystemAdministratorGuard } from "./administrative-guards.js";

function contextFor(request: unknown) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe("administrative guards", () => {
  it("allows only an authenticated system administrator", () => {
    const guard = new SystemAdministratorGuard();
    const admin = { identity: { user: { isSystemAdmin: true } } };

    expect(guard.canActivate(contextFor(admin))).toBe(true);
    expect(() =>
      guard.canActivate(contextFor({ identity: { user: { isSystemAdmin: false } } })),
    ).toThrow(ForbiddenException);
    expect(() => guard.canActivate(contextFor({}))).toThrow(ForbiddenException);
  });

  it("requires a valid session-bound CSRF header", () => {
    const guard = new SessionCsrfGuard();
    const token = "a".repeat(43);
    const request = {
      headers: {
        cookie: `${sessionCookieName}=${token}`,
        "x-csrf-token": deriveCsrfToken(token),
      },
    };

    expect(guard.canActivate(contextFor(request))).toBe(true);
    expect(() =>
      guard.canActivate(
        contextFor({ ...request, headers: { ...request.headers, "x-csrf-token": "invalid" } }),
      ),
    ).toThrow(ForbiddenException);
    expect(() => guard.canActivate(contextFor({ headers: {} }))).toThrow(ForbiddenException);
  });
});
