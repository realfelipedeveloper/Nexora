import { createHmac, timingSafeEqual } from "node:crypto";

const csrfContext = "nexora:csrf:v1";
const encodedTokenPattern = /^[A-Za-z0-9_-]{43}$/u;

export const csrfHeaderName = "x-csrf-token";
export const sessionCookieName = "nexora_session";

type SessionCookieOptions = {
  expires: Date;
  httpOnly: true;
  path: "/";
  sameSite: "strict";
  secure: boolean;
};

export function deriveCsrfToken(sessionToken: string) {
  if (!encodedTokenPattern.test(sessionToken)) {
    throw new TypeError("A valid session token is required.");
  }

  return createHmac("sha256", sessionToken).update(csrfContext, "utf8").digest("base64url");
}

export function isValidCsrfToken(sessionToken: string, candidate: string | undefined) {
  if (!candidate || !encodedTokenPattern.test(candidate)) {
    return false;
  }

  const expected = Buffer.from(deriveCsrfToken(sessionToken), "utf8");
  const actual = Buffer.from(candidate, "utf8");

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function readSessionCookie(cookieHeader: string | undefined) {
  if (!cookieHeader) {
    return undefined;
  }

  const values = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${sessionCookieName}=`))
    .map((part) => part.slice(sessionCookieName.length + 1));

  if (values.length !== 1 || !encodedTokenPattern.test(values[0] ?? "")) {
    return undefined;
  }

  return values[0];
}

export function sessionCookieOptions(secure: boolean, expires: Date): SessionCookieOptions {
  return {
    expires,
    httpOnly: true,
    path: "/",
    sameSite: "strict",
    secure,
  };
}

export function sessionCookieClearOptions(secure: boolean) {
  return {
    httpOnly: true as const,
    path: "/" as const,
    sameSite: "strict" as const,
    secure,
  };
}
