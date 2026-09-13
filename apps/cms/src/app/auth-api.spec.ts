import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthenticationApiError, login, logout, restoreSession } from "./auth-api";

const session = {
  csrfToken: "a".repeat(43),
  expiresAt: "2030-01-01T00:00:00.000Z",
  user: {
    displayName: "Nexora Admin",
    email: "admin@example.com",
    id: "user-1",
    isSystemAdmin: true,
  },
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CMS authentication API", () => {
  it("restores a session using same-origin credentials without caching", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(session));
    vi.stubGlobal("fetch", fetchMock);

    await expect(restoreSession()).resolves.toEqual(session);
    expect(fetchMock).toHaveBeenCalledWith("/api/core/auth/session", {
      cache: "no-store",
      credentials: "include",
      method: "GET",
      signal: undefined,
    });
  });

  it("sends login credentials only in a JSON request body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(session));
    vi.stubGlobal("fetch", fetchMock);

    await login("admin@example.com", "correct horse battery staple");

    expect(fetchMock).toHaveBeenCalledWith("/api/core/auth/login", {
      body: JSON.stringify({
        email: "admin@example.com",
        password: "correct horse battery staple",
      }),
      cache: "no-store",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal: undefined,
    });
  });

  it("preserves an authentication failure status without parsing its body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ message: "hidden" }, 401)));

    await expect(login("admin@example.com", "wrong password")).rejects.toMatchObject({
      name: "AuthenticationApiError",
      status: 401,
    });
  });

  it("rejects malformed successful responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ ...session, csrfToken: "not-valid" })),
    );

    await expect(restoreSession()).rejects.toThrow("Invalid authentication response.");
  });

  it("sends the in-memory CSRF token when logging out", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(logout(session.csrfToken)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith("/api/core/auth/logout", {
      cache: "no-store",
      credentials: "include",
      headers: { "x-csrf-token": session.csrfToken },
      method: "POST",
    });
  });

  it("exposes logout failures as typed API errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 403 })));

    await expect(logout(session.csrfToken)).rejects.toBeInstanceOf(AuthenticationApiError);
  });
});
