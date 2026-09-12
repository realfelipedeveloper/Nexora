import { ConflictException, type ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import {
  AuthenticationFailedError,
  type IdentityService,
  SessionRotationConflictError,
} from "./identity.service.js";
import { SessionAuthenticationGuard } from "./session-authentication.guard.js";
import { deriveCsrfToken, sessionCookieName } from "./session-security.js";

const oldToken = "a".repeat(43);
const newToken = "b".repeat(43);
const expiresAt = new Date("2030-01-01T08:00:00.000Z");

function requestContext(cookie = `${sessionCookieName}=${oldToken}`) {
  const request = { headers: { cookie } };
  const response = {
    clearCookie: vi.fn(),
    cookie: vi.fn(),
    setHeader: vi.fn(),
  };
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;

  return { context, request, response };
}

function authenticatedSession(rotated: boolean) {
  const sessionToken = rotated ? newToken : oldToken;
  return {
    csrfToken: deriveCsrfToken(sessionToken),
    expiresAt,
    rotated,
    sessionId: "session-1",
    sessionToken,
    user: {
      displayName: "Admin",
      email: "admin@example.com",
      id: "user-1",
      isSystemAdmin: true,
    },
  };
}

describe("SessionAuthenticationGuard", () => {
  it("attaches an authenticated identity without exposing its bearer token", async () => {
    const identity = {
      authenticateSession: vi.fn().mockResolvedValue(authenticatedSession(false)),
    };
    const guard = new SessionAuthenticationGuard(identity as unknown as IdentityService, {
      secureCookies: false,
    });
    const { context, request, response } = requestContext();

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request).toHaveProperty("identity.user.id", "user-1");
    expect(request).not.toHaveProperty("identity.sessionToken");
    expect(response.cookie).not.toHaveBeenCalled();
  });

  it("sets a successor cookie and CSRF header after rotation", async () => {
    const session = authenticatedSession(true);
    const identity = { authenticateSession: vi.fn().mockResolvedValue(session) };
    const guard = new SessionAuthenticationGuard(identity as unknown as IdentityService, {
      secureCookies: true,
    });
    const { context, response } = requestContext();

    await guard.canActivate(context);

    expect(response.cookie).toHaveBeenCalledWith(sessionCookieName, newToken, {
      expires: expiresAt,
      httpOnly: true,
      path: "/",
      sameSite: "strict",
      secure: true,
    });
    expect(response.setHeader).toHaveBeenCalledWith("x-csrf-token", deriveCsrfToken(newToken));
  });

  it("clears invalid session cookies and returns unauthorized", async () => {
    const identity = {
      authenticateSession: vi.fn().mockRejectedValue(new AuthenticationFailedError()),
    };
    const guard = new SessionAuthenticationGuard(identity as unknown as IdentityService, {
      secureCookies: true,
    });
    const { context, response } = requestContext("malformed=value");

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(identity.authenticateSession).toHaveBeenCalledWith(undefined);
    expect(response.clearCookie).toHaveBeenCalledWith(sessionCookieName, {
      httpOnly: true,
      path: "/",
      sameSite: "strict",
      secure: true,
    });
  });

  it("asks the client to retry a contested rotation", async () => {
    const identity = {
      authenticateSession: vi.fn().mockRejectedValue(new SessionRotationConflictError()),
    };
    const guard = new SessionAuthenticationGuard(identity as unknown as IdentityService, {
      secureCookies: false,
    });
    const { context, response } = requestContext();

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ConflictException);
    expect(response.setHeader).toHaveBeenCalledWith("Retry-After", "1");
  });

  it("preserves unexpected authentication failures", async () => {
    const failure = new Error("persistence unavailable");
    const identity = { authenticateSession: vi.fn().mockRejectedValue(failure) };
    const guard = new SessionAuthenticationGuard(identity as unknown as IdentityService, {
      secureCookies: false,
    });

    await expect(guard.canActivate(requestContext().context)).rejects.toBe(failure);
  });
});
