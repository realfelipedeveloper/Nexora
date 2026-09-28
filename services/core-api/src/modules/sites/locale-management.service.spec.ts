import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  LocaleConflictError,
  LocaleManagementService,
  LocalePreconditionFailedError,
} from "./locale-management.service.js";

const siteId = "10000000-0000-4000-8000-000000000001";
const portugueseId = "20000000-0000-4000-8000-000000000001";
const englishId = "20000000-0000-4000-8000-000000000002";

function delegate() {
  return {
    count: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    updateMany: vi.fn(),
  };
}

function fixture() {
  const transaction = { auditEvent: { create: vi.fn() }, locale: delegate() };
  const prisma = {
    $transaction: vi.fn(async (callback: (client: typeof transaction) => unknown) =>
      callback(transaction),
    ),
    site: { findFirst: vi.fn() },
  };
  return {
    prisma,
    service: new LocaleManagementService(prisma as unknown as PrismaClient),
    transaction,
  };
}

function locale(id: string, code: string, isDefault: boolean, fallbackLocaleId: string | null) {
  return {
    code,
    createdAt: new Date(),
    fallbackLocale: null,
    fallbackLocaleId,
    id,
    isDefault,
    updatedAt: new Date(),
    version: 1,
  };
}

describe("LocaleManagementService", () => {
  it("creates the first locale as the default and audits it atomically", async () => {
    const { service, transaction } = fixture();
    const created = locale(portugueseId, "pt-BR", true, null);
    transaction.locale.count.mockResolvedValue(0);
    transaction.locale.create.mockResolvedValue(created);

    await expect(service.create("actor-1", siteId, { code: " pt-br " })).resolves.toEqual(created);
    expect(transaction.locale.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { code: "pt-BR", fallbackLocaleId: null, isDefault: true, siteId },
      }),
    );
    expect(transaction.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "localization.locale.created" }),
      }),
    );
  });

  it("rejects a fallback cycle before changing the locale", async () => {
    const { service, transaction } = fixture();
    transaction.locale.findUnique.mockResolvedValue({
      fallbackLocaleId: null,
      id: portugueseId,
      isDefault: false,
    });
    transaction.locale.findMany.mockResolvedValue([
      { fallbackLocaleId: null, id: portugueseId },
      { fallbackLocaleId: portugueseId, id: englishId },
    ]);

    await expect(
      service.update("actor-1", siteId, portugueseId, { fallbackLocaleId: englishId }, 1),
    ).rejects.toBeInstanceOf(LocaleConflictError);
    expect(transaction.locale.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a stale locale update", async () => {
    const { service, transaction } = fixture();
    transaction.locale.findUnique.mockResolvedValue({
      fallbackLocaleId: null,
      id: portugueseId,
      isDefault: false,
    });
    transaction.locale.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.update("actor-1", siteId, portugueseId, { fallbackLocaleId: null }, 7),
    ).rejects.toBeInstanceOf(LocalePreconditionFailedError);
  });

  it("resolves the configured chain and uses the default for an unknown locale", async () => {
    const { prisma, service } = fixture();
    vi.mocked(prisma.site.findFirst).mockResolvedValue({
      id: siteId,
      locales: [
        { code: "en-US", fallbackLocaleId: null, id: englishId, isDefault: true },
        { code: "pt-BR", fallbackLocaleId: englishId, id: portugueseId, isDefault: false },
      ],
    });

    await expect(service.resolvePublic("main", "pt-br")).resolves.toEqual({
      locales: [
        { code: "pt-BR", id: portugueseId },
        { code: "en-US", id: englishId },
      ],
      requestedLocale: "pt-BR",
      siteId,
    });
    await expect(service.resolvePublic("main", "es-ES")).resolves.toEqual({
      locales: [{ code: "en-US", id: englishId }],
      requestedLocale: "es-ES",
      siteId,
    });
  });
});
