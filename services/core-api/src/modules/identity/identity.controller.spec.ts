import {
  ForbiddenException,
  UnauthorizedException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { IdentityController } from "./identity.controller.js";
import {
  AuthenticationFailedError,
  CsrfValidationError,
  type IdentityService,
} from "./identity.service.js";
import { deriveCsrfToken, sessionCookieName } from "./session-security.js";

const sessionToken = "a".repeat(43);
const expiresAt = new Date("2030-01-01T08:00:00.000Z");

function responseMock() {
  return {
    clearCookie: vi.fn(),
    cookie: vi.fn(),
  };
}

function serviceMock() {
  return {
    currentSession: vi.fn().mockResolvedValue({
      csrfToken: deriveCsrfToken(sessionToken),
      expiresAt,
      user: { displayName: "Admin", email: "admin@example.com", id: "user-1" },
    }),
    login: vi.fn().mockResolvedValue({
      csrfToken: deriveCsrfToken(sessionToken),
      expiresAt,
      sessionToken,
      user: { displayName: "Admin", email: "admin@example.com", id: "user-1" },
    }),
    logout: vi.fn().mockResolvedValue(undefined),
  };
}

describe("IdentityController", () => {
  it("sets the secure session cookie without returning its bearer token", async () => {
    const service = serviceMock();
    const response = responseMock();
    const controller = new IdentityController(service as unknown as IdentityService, {
      secureCookies: true,
    });

    const result = await controller.login(
      { email: "admin@example.com", password: "correct horse battery staple" },
      "application/json; charset=utf-8",
      response,
    );

    expect(response.cookie).toHaveBeenCalledWith(sessionCookieName, sessionToken, {
      expires: expiresAt,
      httpOnly: true,
      path: "/",
      sameSite: "strict",
      secure: true,
    });
    expect(result).not.toHaveProperty("sessionToken");
    expect(result).toMatchObject({ csrfToken: deriveCsrfToken(sessionToken) });
  });

  it("rejects non-JSON and malformed login requests generically", async () => {
    const service = serviceMock();
    const controller = new IdentityController(service as unknown as IdentityService, {
      secureCookies: false,
    });

    await expect(
      controller.login(
        { email: "admin@example.com", password: "valid password" },
        "text/plain",
        responseMock(),
      ),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
    await expect(
      controller.login(
        { email: "admin@example.com", password: "valid password" },
        "application/jsonp",
        responseMock(),
      ),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
    for (const body of [
      null,
      [],
      "invalid",
      { email: "admin@example.com" },
      { email: 1, password: "valid password" },
      { email: "admin@example.com", password: 1 },
      { email: "", password: "valid password" },
      { email: "admin@example.com", password: "" },
    ]) {
      await expect(
        controller.login(body, "application/json", responseMock()),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }
    await expect(controller.login({}, undefined, responseMock())).rejects.toBeInstanceOf(
      UnsupportedMediaTypeException,
    );
    expect(service.login).not.toHaveBeenCalled();
  });

  it("maps authentication failures to the same unauthorized response", async () => {
    const service = serviceMock();
    service.login.mockRejectedValue(new AuthenticationFailedError());
    const controller = new IdentityController(service as unknown as IdentityService, {
      secureCookies: false,
    });

    await expect(
      controller.login(
        { email: "unknown@example.com", password: "wrong password" },
        "application/json",
        responseMock(),
      ),
    ).rejects.toMatchObject({ message: "Invalid email or password.", status: 401 });
  });

  it("reads the current session from the cookie", async () => {
    const service = serviceMock();
    const controller = new IdentityController(service as unknown as IdentityService, {
      secureCookies: false,
    });

    await expect(
      controller.currentSession(`theme=dark; ${sessionCookieName}=${sessionToken}`),
    ).resolves.toMatchObject({ user: { id: "user-1" } });
    expect(service.currentSession).toHaveBeenCalledWith(sessionToken);
  });

  it("requires CSRF for an active logout and clears the cookie after success", async () => {
    const service = serviceMock();
    const response = responseMock();
    const controller = new IdentityController(service as unknown as IdentityService, {
      secureCookies: true,
    });

    await controller.logout(
      `${sessionCookieName}=${sessionToken}`,
      deriveCsrfToken(sessionToken),
      response,
    );

    expect(service.logout).toHaveBeenCalledWith(sessionToken, deriveCsrfToken(sessionToken));
    expect(response.clearCookie).toHaveBeenCalledWith(sessionCookieName, {
      httpOnly: true,
      path: "/",
      sameSite: "strict",
      secure: true,
    });
  });

  it("does not clear the cookie when CSRF validation fails", async () => {
    const service = serviceMock();
    service.logout.mockRejectedValue(new CsrfValidationError());
    const response = responseMock();
    const controller = new IdentityController(service as unknown as IdentityService, {
      secureCookies: false,
    });

    await expect(
      controller.logout(`${sessionCookieName}=${sessionToken}`, undefined, response),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(response.clearCookie).not.toHaveBeenCalled();
  });

  it("preserves unexpected service failures", async () => {
    const failure = new Error("persistence unavailable");
    const service = serviceMock();
    const controller = new IdentityController(service as unknown as IdentityService, {
      secureCookies: false,
    });

    service.login.mockRejectedValueOnce(failure);
    await expect(
      controller.login(
        { email: "admin@example.com", password: "valid password" },
        "application/json",
        responseMock(),
      ),
    ).rejects.toBe(failure);

    service.currentSession.mockRejectedValueOnce(failure);
    await expect(controller.currentSession(`${sessionCookieName}=${sessionToken}`)).rejects.toBe(
      failure,
    );

    service.logout.mockRejectedValueOnce(failure);
    await expect(
      controller.logout(`${sessionCookieName}=${sessionToken}`, undefined, responseMock()),
    ).rejects.toBe(failure);
  });
});
