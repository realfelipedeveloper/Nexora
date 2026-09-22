import { Prisma, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  AdminAlreadyProvisionedError,
  InvalidAdminProfileError,
  provisionInitialAdmin,
} from "./admin-provisioning.js";

function prismaWithTransaction(
  transaction: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0],
) {
  return {
    $transaction: vi.fn(async (callback: (client: typeof transaction) => unknown) =>
      callback(transaction),
    ),
    user: {
      findFirst: vi.fn(),
    },
  } as unknown as PrismaClient;
}

describe("initial administrator provisioning", () => {
  it("normalizes the profile and writes the audit event atomically", async () => {
    const acquireProvisioningLock = vi.fn().mockResolvedValue([{ locked: "" }]);
    const findExistingAdmin = vi.fn().mockResolvedValue(null);
    const transaction = {
      $queryRaw: acquireProvisioningLock,
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
      user: {
        create: vi.fn().mockResolvedValue({
          displayName: "Nexora Admin",
          email: "Admin@Example.com",
          id: "admin-1",
        }),
        findFirst: findExistingAdmin,
      },
    } as unknown as Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
    const prisma = prismaWithTransaction(transaction);

    await expect(
      provisionInitialAdmin(prisma, {
        displayName: "  Nexora Admin  ",
        email: "  Admin@Example.com  ",
        password: "correct horse battery staple",
      }),
    ).resolves.toEqual({
      displayName: "Nexora Admin",
      email: "Admin@Example.com",
      id: "admin-1",
    });

    expect(transaction.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          displayName: "Nexora Admin",
          email: "Admin@Example.com",
          isSystemAdmin: true,
          normalizedEmail: "admin@example.com",
          passwordHash: expect.stringMatching(/^\$argon2id\$/u),
        }),
      }),
    );
    expect(acquireProvisioningLock).toHaveBeenCalledOnce();
    expect(acquireProvisioningLock.mock.invocationCallOrder[0]).toBeLessThan(
      findExistingAdmin.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(transaction.auditEvent.create).toHaveBeenCalledWith({
      data: {
        action: "identity.system_admin.provisioned",
        actorId: "admin-1",
        entity: "User",
        entityId: "admin-1",
        metadata: { source: "admin-provisioning-cli" },
      },
    });
  });

  it("refuses to replace an existing system administrator", async () => {
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ locked: "" }]),
      user: {
        findFirst: vi.fn().mockResolvedValue({ id: "existing-admin" }),
      },
    } as unknown as Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

    await expect(
      provisionInitialAdmin(prismaWithTransaction(transaction), {
        displayName: "Another Admin",
        email: "another@example.com",
        password: "correct horse battery staple",
      }),
    ).rejects.toBeInstanceOf(AdminAlreadyProvisionedError);
  });

  it("maps a unique constraint race to the existing administrator", async () => {
    const prismaError = new Prisma.PrismaClientKnownRequestError("race", {
      clientVersion: "7.10.0",
      code: "P2002",
    });
    const prisma = {
      $transaction: vi.fn().mockRejectedValue(prismaError),
      user: { findFirst: vi.fn().mockResolvedValue({ id: "winner" }) },
    } as unknown as PrismaClient;

    await expect(
      provisionInitialAdmin(prisma, {
        displayName: "Concurrent Admin",
        email: "concurrent@example.com",
        password: "correct horse battery staple",
      }),
    ).rejects.toBeInstanceOf(AdminAlreadyProvisionedError);
    expect(prisma.$transaction).toHaveBeenCalledOnce();
  });

  it("uses a bounded read-committed transaction", async () => {
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ locked: "" }]),
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
      user: {
        create: vi.fn().mockResolvedValue({
          displayName: "Admin",
          email: "admin@example.com",
          id: "admin-1",
        }),
        findFirst: vi.fn().mockResolvedValue(null),
      },
    } as unknown as Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
    const prisma = prismaWithTransaction(transaction);

    await expect(
      provisionInitialAdmin(prisma, {
        displayName: "Admin",
        email: "admin@example.com",
        password: "correct horse battery staple",
      }),
    ).resolves.toEqual({
      displayName: "Admin",
      email: "admin@example.com",
      id: "admin-1",
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5_000,
      timeout: 10_000,
    });
  });

  it("preserves a unique constraint error when no administrator won the race", async () => {
    const prismaError = new Prisma.PrismaClientKnownRequestError("race", {
      clientVersion: "7.10.0",
      code: "P2002",
    });
    const prisma = {
      $transaction: vi.fn().mockRejectedValue(prismaError),
      user: { findFirst: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaClient;

    await expect(
      provisionInitialAdmin(prisma, {
        displayName: "Concurrent Admin",
        email: "concurrent@example.com",
        password: "correct horse battery staple",
      }),
    ).rejects.toBe(prismaError);
    expect(prisma.$transaction).toHaveBeenCalledOnce();
  });

  it("preserves unexpected persistence errors", async () => {
    const failure = new Error("connection lost");
    const prisma = {
      $transaction: vi.fn().mockRejectedValue(failure),
    } as unknown as PrismaClient;

    await expect(
      provisionInitialAdmin(prisma, {
        displayName: "Admin",
        email: "admin@example.com",
        password: "correct horse battery staple",
      }),
    ).rejects.toBe(failure);
  });

  it.each([
    { displayName: "Admin", email: "invalid", label: "invalid email" },
    { displayName: "Admin", email: "a".repeat(250) + "@x.io", label: "long email" },
    { displayName: "   ", email: "admin@example.com", label: "empty name" },
    { displayName: "a".repeat(121), email: "admin@example.com", label: "long name" },
  ])("rejects an $label", async ({ displayName, email }) => {
    await expect(
      provisionInitialAdmin({} as PrismaClient, {
        displayName,
        email,
        password: "correct horse battery staple",
      }),
    ).rejects.toBeInstanceOf(InvalidAdminProfileError);
  });
});
