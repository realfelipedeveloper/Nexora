const csrfTokenPattern = /^[A-Za-z0-9_-]{43}$/u;

export type CmsSession = {
  csrfToken: string;
  expiresAt: string;
  user: {
    displayName: string;
    email: string;
    id: string;
    isSystemAdmin: boolean;
  };
};

export class AuthenticationApiError extends Error {
  override readonly name = "AuthenticationApiError";

  constructor(readonly status: number) {
    super(`Authentication request failed with status ${status}.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseSession(value: unknown): CmsSession {
  if (!isRecord(value) || !isRecord(value.user)) {
    throw new TypeError("Invalid authentication response.");
  }

  const { csrfToken, expiresAt, user } = value;
  if (
    typeof csrfToken !== "string" ||
    !csrfTokenPattern.test(csrfToken) ||
    typeof expiresAt !== "string" ||
    !Number.isFinite(Date.parse(expiresAt)) ||
    typeof user.displayName !== "string" ||
    !user.displayName.trim() ||
    typeof user.email !== "string" ||
    !user.email.trim() ||
    typeof user.id !== "string" ||
    !user.id ||
    typeof user.isSystemAdmin !== "boolean"
  ) {
    throw new TypeError("Invalid authentication response.");
  }

  return {
    csrfToken,
    expiresAt,
    user: {
      displayName: user.displayName,
      email: user.email,
      id: user.id,
      isSystemAdmin: user.isSystemAdmin,
    },
  };
}

async function sessionRequest(path: string, init: RequestInit) {
  const response = await fetch(`/api/core${path}`, {
    ...init,
    cache: "no-store",
    credentials: "include",
  });

  if (!response.ok) {
    throw new AuthenticationApiError(response.status);
  }

  return parseSession(await response.json());
}

export function restoreSession(signal?: AbortSignal) {
  return sessionRequest("/auth/session", { method: "GET", signal });
}

export function login(email: string, password: string, signal?: AbortSignal) {
  return sessionRequest("/auth/login", {
    body: JSON.stringify({ email, password }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
    signal,
  });
}

export async function logout(csrfToken: string) {
  const response = await fetch("/api/core/auth/logout", {
    cache: "no-store",
    credentials: "include",
    headers: { "x-csrf-token": csrfToken },
    method: "POST",
  });

  if (!response.ok) {
    throw new AuthenticationApiError(response.status);
  }
}
