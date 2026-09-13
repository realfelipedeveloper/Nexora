import { Prisma, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  InvalidSiteLifecycleInputError,
  SiteKeyConflictError,
  SiteLifecycleService,
  SiteNotFoundError,
} from "./site-lifecycle.service.js";

const activeSite = {
  createdAt: new Date("2026-01-01T00:00:00Z"),
  id: "00000000-0000-4000-8000-000000000001",
  key: "main-site",
  name: "Main Site",
  status: "ACTIVE" as const,
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

function transactionClient(transaction: object) {
  return {
    $transaction: vi.fn(async (callback: (client: typeof transaction) => unknown) =>
      callback(transaction),
    ),
    site: { findMany: vi.fn(), findUnique: vi.fn() },
  } as unknown as PrismaClient;
}

describe("SiteLifecycleService", () => {
  it("lists every site for system administrators and only assigned sites for editors", async () => {
    const prisma = transactionClient({});
    vi.mocked(prisma.site.findMany).mockResolvedValue([]);
    const service = new SiteLifecycleService(prisma);

    await service.listAccessible("admin-1", true);
    expect(prisma.site.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: undefined }),
    );

    await service.listAccessible("editor-1", false);
    expect(prisma.site.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { roleAssignments: { some: { userId: "editor-1" } } },
      }),
    );
  });

  it("creates a normalized site and its audit event atomically", async () => {
    const transaction = {
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
      site: { create: vi.fn().mockResolvedValue(activeSite) },
    };
    const prisma = transactionClient(transaction);
    const service = new SiteLifecycleService(prisma);

    await expect(
      service.create("admin-1", { key: "main-site", name: "  Main Site  " }),
    ).resolves.toEqual(activeSite);
    expect(transaction.site.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { key: "main-site", name: "Main Site" } }),
    );
    expect(transaction.auditEvent.create).toHaveBeenCalledWith({
      data: {
        action: "site.created",
        actorId: "admin-1",
        entity: "Site",
        entityId: activeSite.id,
        metadata: { key: "main-site", status: "ACTIVE" },
      },
    });
  });

  it("rejects invalid input without retaining it and maps unique key conflicts", async () => {
    const prisma = transactionClient({});
    const service = new SiteLifecycleService(prisma);
    const secret = "NeverEchoThisToken";

    let captured: unknown;
    try {
      await service.create("admin-1", { key: "INVALID", name: secret });
    } catch (error) {
      captured = error;
    }
    expect(captured).toBeInstanceOf(InvalidSiteLifecycleInputError);
    expect(JSON.stringify(captured)).not.toContain(secret);
    expect(prisma.$transaction).not.toHaveBeenCalled();

    const conflict = new Prisma.PrismaClientKnownRequestError("duplicate", {
      clientVersion: "7.10.0",
      code: "P2002",
    });
    vi.mocked(prisma.$transaction).mockRejectedValueOnce(conflict);
    await expect(
      service.create("admin-1", { key: "main-site", name: "Main" }),
    ).rejects.toBeInstanceOf(SiteKeyConflictError);
  });

  it("changes status with an audit event and treats repeated commands as idempotent", async () => {
    const archivedSite = { ...activeSite, status: "ARCHIVED" as const };
    const transaction = {
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
      site: {
        findUnique: vi.fn().mockResolvedValueOnce(activeSite).mockResolvedValueOnce(archivedSite),
        update: vi.fn().mockResolvedValue(archivedSite),
      },
    };
    const service = new SiteLifecycleService(transactionClient(transaction));

    await expect(
      service.updateStatus("admin-1", activeSite.id, { status: "ARCHIVED" }),
    ).resolves.toEqual(archivedSite);
    expect(transaction.auditEvent.create).toHaveBeenCalledWith({
      data: {
        action: "site.status.changed",
        actorId: "admin-1",
        entity: "Site",
        entityId: activeSite.id,
        metadata: { from: "ACTIVE", to: "ARCHIVED" },
      },
    });

    await expect(
      service.updateStatus("admin-1", activeSite.id, { status: "ARCHIVED" }),
    ).resolves.toEqual(archivedSite);
    expect(transaction.site.update).toHaveBeenCalledTimes(1);
    expect(transaction.auditEvent.create).toHaveBeenCalledTimes(1);
  });

  it("reports missing sites and retries serialization conflicts", async () => {
    const missingTransaction = {
      site: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    const missingService = new SiteLifecycleService(transactionClient(missingTransaction));
    await expect(
      missingService.updateStatus("admin-1", activeSite.id, { status: "ARCHIVED" }),
    ).rejects.toBeInstanceOf(SiteNotFoundError);

    const conflict = new Prisma.PrismaClientKnownRequestError("serialization", {
      clientVersion: "7.10.0",
      code: "P2034",
    });
    const archivedSite = { ...activeSite, status: "ARCHIVED" as const };
    const transaction = {
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
      site: {
        findUnique: vi.fn().mockResolvedValue(activeSite),
        update: vi.fn().mockResolvedValue(archivedSite),
      },
    };
    const prisma = transactionClient(transaction);
    vi.mocked(prisma.$transaction).mockRejectedValueOnce(conflict);
    const service = new SiteLifecycleService(prisma);

    await expect(
      service.updateStatus("admin-1", activeSite.id, { status: "ARCHIVED" }),
    ).resolves.toEqual(archivedSite);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });
});
