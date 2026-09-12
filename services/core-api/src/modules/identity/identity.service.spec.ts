import type { PrismaClient } from "@prisma/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "./credentials.js";
import {
  AuthenticationFailedError,
  CsrfValidationError,
  IdentityService,
  SessionRotationConflictError,
} from "./identity.service.js";
import { deriveCsrfToken } from "./session-security.js";

const now = new Date("2030-01-01T00:00:00.000Z");
const sessionToken = "a".repeat(43);
let passwordHash: string;
const configuration = {
  sessionRotationIntervalMs: 15 * 60 * 1_000,
  sessionTtlMs: 8 * 60 * 60 * 1_000,
};

function prismaMock() {
  const transaction = {
    auditEvent: { create: vi.fn().mockResolvedValue({}) },
    session: {
      create: vi.fn().mockResolvedValue({ id: "session-1" }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };

  return {
    $transaction: vi.fn(async (callback: (client: typeof transaction) => unknown) =>
      callback(transaction),
    ),
    session: { findUnique: vi.fn() },
    transaction,
    user: { findUnique: vi.fn() },
  };
}

function activeUser() {
  return {
    displayName: "Nexora Admin",
    email: "Admin@example.com",
    id: "user-1",
    isSystemAdmin: true,
    passwordHash,
    passwordChangedAt: new Date("2029-12-01T00:00:00.000Z"),
    status: "ACTIVE" as const,
  };
}

function activeSession() {
  return {
    createdAt: new Date("2029-12-31T23:00:00.000Z"),
    expiresAt: new Date("2030-01-01T08:00:00.000Z"),
    id: "session-1",
    lastSeenAt: new Date("2029-12-31T23:55:00.000Z"),
    revokedAt: null as Date | null,
    user: activeUser(),
  };
}

describe("IdentityService", () => {
  beforeAll(async () => {
    passwordHash = await hashPassword("correct horse battery staple");
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    {
      candidate: "wrong password value",
      email: "admin@example.com",
      user: () => activeUser(),
    },
    {
      candidate: "correct horse battery staple",
      email: "admin@example.com",
      user: () => null,
    },
    {
      candidate: "correct horse battery staple",
      email: "admin@example.com",
      user: () => ({ ...activeUser(), status: "DISABLED" as const }),
    },
    {
      candidate: "correct horse battery staple",
      email: "invalid-email",
      user: () => null,
    },
    {
      candidate: "short",
      email: "admin@example.com",
      user: () => activeUser(),
    },
    {
      candidate: "a".repeat(129),
      email: "admin@example.com",
      user: () => activeUser(),
    },
    {
      candidate: "correct horse battery staple",
      email: `${"a".repeat(250)}@x.io`,
      user: () => null,
    },
  ])("returns the same failure for invalid credentials", async ({ candidate, email, user }) => {
    const prisma = prismaMock();
    prisma.user.findUnique.mockResolvedValue(user());
    const service = new IdentityService(prisma as unknown as PrismaClient, configuration);

    await expect(service.login(email, candidate)).rejects.toEqual(new AuthenticationFailedError());
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("creates an opaque session and audit event atomically", async () => {
    const prisma = prismaMock();
    prisma.user.findUnique.mockResolvedValue(activeUser());
    const service = new IdentityService(prisma as unknown as PrismaClient, configuration);

    const result = await service.login("  ADMIN@example.com ", "correct horse battery staple");

    expect(result.sessionToken).toHaveLength(43);
    expect(result.csrfToken).toBe(deriveCsrfToken(result.sessionToken));
    expect(result.expiresAt).toEqual(new Date("2030-01-01T08:00:00.000Z"));
    expect(result.user).toEqual({
      displayName: "Nexora Admin",
      email: "Admin@example.com",
      id: "user-1",
      isSystemAdmin: true,
    });
    expect(prisma.transaction.session.create).toHaveBeenCalledWith({
      data: {
        expiresAt: result.expiresAt,
        tokenHash: expect.not.stringContaining(result.sessionToken),
        userId: "user-1",
      },
      select: { id: true },
    });
    expect(prisma.transaction.auditEvent.create).toHaveBeenCalledWith({
      data: {
        action: "identity.session.created",
        actorId: "user-1",
        entity: "Session",
        entityId: "session-1",
        metadata: {},
      },
    });
  });

  it("returns the current active session without exposing its stored hash", async () => {
    const prisma = prismaMock();
    prisma.session.findUnique.mockResolvedValue(activeSession());
    const service = new IdentityService(prisma as unknown as PrismaClient, configuration);

    await expect(service.currentSession(sessionToken)).resolves.toEqual({
      csrfToken: deriveCsrfToken(sessionToken),
      expiresAt: new Date("2030-01-01T08:00:00.000Z"),
      user: {
        displayName: "Nexora Admin",
        email: "Admin@example.com",
        id: "user-1",
        isSystemAdmin: true,
      },
    });
  });

  it("rejects a request without a session token before querying persistence", async () => {
    const prisma = prismaMock();
    const service = new IdentityService(prisma as unknown as PrismaClient, configuration);

    await expect(service.currentSession(undefined)).rejects.toBeInstanceOf(
      AuthenticationFailedError,
    );
    expect(prisma.session.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    null,
    { ...activeSession(), expiresAt: new Date("2029-12-31T23:59:59.000Z") },
    { ...activeSession(), revokedAt: now },
    { ...activeSession(), user: { ...activeUser(), status: "DISABLED" as const } },
    {
      ...activeSession(),
      user: { ...activeUser(), passwordChangedAt: new Date("2029-12-31T23:30:00.000Z") },
    },
  ])("rejects a missing or inactive current session", async (session) => {
    const prisma = prismaMock();
    prisma.session.findUnique.mockResolvedValue(session);
    const service = new IdentityService(prisma as unknown as PrismaClient, configuration);

    await expect(service.currentSession(sessionToken)).rejects.toBeInstanceOf(
      AuthenticationFailedError,
    );
  });

  it("requires a session-bound CSRF token before logout", async () => {
    const prisma = prismaMock();
    prisma.session.findUnique.mockResolvedValue(activeSession());
    const service = new IdentityService(prisma as unknown as PrismaClient, configuration);

    await expect(service.logout(sessionToken, "b".repeat(43))).rejects.toBeInstanceOf(
      CsrfValidationError,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("revokes a session and audits logout atomically", async () => {
    const prisma = prismaMock();
    prisma.session.findUnique.mockResolvedValue(activeSession());
    const service = new IdentityService(prisma as unknown as PrismaClient, configuration);

    await service.logout(sessionToken, deriveCsrfToken(sessionToken));

    expect(prisma.transaction.session.updateMany).toHaveBeenCalledWith({
      data: { revokedAt: now },
      where: { id: "session-1", revokedAt: null },
    });
    expect(prisma.transaction.auditEvent.create).toHaveBeenCalledWith({
      data: {
        action: "identity.session.revoked",
        actorId: "user-1",
        entity: "Session",
        entityId: "session-1",
        metadata: { reason: "logout" },
      },
    });
  });

  it("does not duplicate the logout audit when another request revoked the session", async () => {
    const prisma = prismaMock();
    prisma.session.findUnique.mockResolvedValue(activeSession());
    prisma.transaction.session.updateMany.mockResolvedValue({ count: 0 });
    const service = new IdentityService(prisma as unknown as PrismaClient, configuration);

    await service.logout(sessionToken, deriveCsrfToken(sessionToken));

    expect(prisma.transaction.auditEvent.create).not.toHaveBeenCalled();
  });

  it("treats logout without an active session as an idempotent success", async () => {
    const prisma = prismaMock();
    prisma.session.findUnique.mockResolvedValue(null);
    const service = new IdentityService(prisma as unknown as PrismaClient, configuration);

    await expect(service.logout(undefined, undefined)).resolves.toBeUndefined();
    await expect(service.logout(sessionToken, undefined)).resolves.toBeUndefined();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rotates an old session token and audits the single winning update", async () => {
    const prisma = prismaMock();
    const session = {
      ...activeSession(),
      lastSeenAt: new Date("2029-12-31T23:40:00.000Z"),
    };
    prisma.session.findUnique.mockResolvedValue(session);
    const service = new IdentityService(prisma as unknown as PrismaClient, configuration);

    const result = await service.authenticateSession(sessionToken);

    expect(result.rotated).toBe(true);
    expect(result.sessionToken).not.toBe(sessionToken);
    expect(prisma.transaction.session.updateMany).toHaveBeenCalledWith({
      data: {
        lastSeenAt: now,
        tokenHash: expect.any(String),
      },
      where: {
        id: "session-1",
        lastSeenAt: session.lastSeenAt,
        revokedAt: null,
        tokenHash: expect.any(String),
      },
    });
    expect(prisma.transaction.auditEvent.create).toHaveBeenCalledWith({
      data: {
        action: "identity.session.rotated",
        actorId: "user-1",
        entity: "Session",
        entityId: "session-1",
        metadata: {},
      },
    });
  });

  it("fails closed when a concurrent request wins rotation", async () => {
    const prisma = prismaMock();
    prisma.session.findUnique.mockResolvedValue({
      ...activeSession(),
      lastSeenAt: new Date("2029-12-31T23:40:00.000Z"),
    });
    prisma.transaction.session.updateMany.mockResolvedValue({ count: 0 });
    const service = new IdentityService(prisma as unknown as PrismaClient, configuration);

    await expect(service.authenticateSession(sessionToken)).rejects.toBeInstanceOf(
      SessionRotationConflictError,
    );
    expect(prisma.transaction.auditEvent.create).not.toHaveBeenCalled();
  });
});
