import { describe, expect, it } from "vitest";
import {
  deriveCsrfToken,
  isValidCsrfToken,
  readSessionCookie,
  sessionCookieName,
  sessionCookieOptions,
} from "./session-security.js";

const sessionToken = "a".repeat(43);

describe("session HTTP security", () => {
  it("derives a stable session-bound CSRF token", () => {
    const csrfToken = deriveCsrfToken(sessionToken);

    expect(csrfToken).toHaveLength(43);
    expect(deriveCsrfToken(sessionToken)).toBe(csrfToken);
    expect(deriveCsrfToken("b".repeat(43))).not.toBe(csrfToken);
    expect(isValidCsrfToken(sessionToken, csrfToken)).toBe(true);
    expect(isValidCsrfToken(sessionToken, "c".repeat(43))).toBe(false);
    expect(isValidCsrfToken(sessionToken, "short")).toBe(false);
    expect(isValidCsrfToken(sessionToken, undefined)).toBe(false);
    expect(() => deriveCsrfToken("malformed")).toThrow(/valid session token/u);
  });

  it("reads exactly one well-formed session cookie", () => {
    expect(readSessionCookie(`theme=dark; ${sessionCookieName}=${sessionToken}`)).toBe(
      sessionToken,
    );
    expect(readSessionCookie(undefined)).toBeUndefined();
    expect(readSessionCookie(`${sessionCookieName}=`)).toBeUndefined();
    expect(readSessionCookie(`${sessionCookieName}=short`)).toBeUndefined();
    expect(
      readSessionCookie(
        `${sessionCookieName}=${sessionToken}; ${sessionCookieName}=${"b".repeat(43)}`,
      ),
    ).toBeUndefined();
  });

  it("uses host-scoped defensive cookie attributes", () => {
    const expiresAt = new Date("2030-01-01T08:00:00.000Z");

    expect(sessionCookieOptions(false, expiresAt)).toEqual({
      expires: expiresAt,
      httpOnly: true,
      path: "/",
      sameSite: "strict",
      secure: false,
    });
    expect(sessionCookieOptions(true, expiresAt)).toMatchObject({ secure: true });
  });
});
