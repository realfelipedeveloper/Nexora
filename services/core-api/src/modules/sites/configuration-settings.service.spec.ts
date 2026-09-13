import { Prisma, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  ConfigurationKeyNotRegisteredError,
  ConfigurationRegistry,
} from "./configuration-registry.js";
import {
  ConfigurationSettingsService,
  SettingNotFoundError,
  SettingPreconditionFailedError,
} from "./configuration-settings.service.js";

const now = new Date("2026-01-01T00:00:00Z");
const globalSetting = {
  createdAt: now,
  key: "platform.branding",
  updatedAt: now,
  value: { productName: "Nexora" },
  version: 1,
};
const siteSetting = {
  createdAt: now,
  key: "site.identity",
  updatedAt: now,
  value: { displayName: "Main Site" },
  version: 1,
};

function prismaFixture(transaction: object = {}) {
  return {
    $transaction: vi.fn(async (callback: (client: typeof transaction) => unknown) =>
      callback(transaction),
    ),
    globalSetting: { findMany: vi.fn(), findUnique: vi.fn() },
    siteSetting: { findMany: vi.fn(), findUnique: vi.fn() },
  } as unknown as PrismaClient;
}

describe("ConfigurationSettingsService", () => {
  it("lists only registered keys in the requested scope", async () => {
    const prisma = prismaFixture();
    vi.mocked(prisma.globalSetting.findMany).mockResolvedValue([]);
    vi.mocked(prisma.siteSetting.findMany).mockResolvedValue([]);
    const service = new ConfigurationSettingsService(prisma, new ConfigurationRegistry());

    await service.listGlobal();
    expect(prisma.globalSetting.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: { in: ["platform.branding"] } } }),
    );
    await service.listSite("site-1");
    expect(prisma.siteSetting.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: { in: ["site.identity"] }, siteId: "site-1" },
      }),
    );
  });

  it("rejects unregistered and missing settings before returning data", async () => {
    const prisma = prismaFixture();
    vi.mocked(prisma.globalSetting.findUnique).mockResolvedValue(null);
    const service = new ConfigurationSettingsService(prisma, new ConfigurationRegistry());

    await expect(service.getGlobal("unknown.key")).rejects.toBeInstanceOf(
      ConfigurationKeyNotRegisteredError,
    );
    expect(prisma.globalSetting.findUnique).not.toHaveBeenCalled();
    await expect(service.getGlobal("platform.branding")).rejects.toBeInstanceOf(
      SettingNotFoundError,
    );
  });

  it("creates normalized global configuration and audits metadata without its value", async () => {
    const transaction = {
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
      globalSetting: {
        create: vi.fn().mockResolvedValue(globalSetting),
      },
    };
    const service = new ConfigurationSettingsService(
      prismaFixture(transaction),
      new ConfigurationRegistry(),
    );

    await expect(
      service.writeGlobal(
        "admin-1",
        "platform.branding",
        { productName: "  Nexora  " },
        { mode: "create" },
      ),
    ).resolves.toEqual(globalSetting);
    expect(transaction.globalSetting.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { key: "platform.branding", value: { productName: "Nexora" } },
      }),
    );
    const auditCall = transaction.auditEvent.create.mock.calls[0]?.[0];
    expect(auditCall).toEqual({
      data: {
        action: "configuration.global.written",
        actorId: "admin-1",
        entity: "GlobalSetting",
        entityId: "platform.branding",
        metadata: { key: "platform.branding", previousVersion: null, version: 1 },
      },
    });
    expect(JSON.stringify(auditCall)).not.toContain("Nexora");
  });

  it("atomically increments a matching global version", async () => {
    const updated = { ...globalSetting, version: 2 };
    const transaction = {
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
      globalSetting: {
        findUniqueOrThrow: vi.fn().mockResolvedValue(updated),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const service = new ConfigurationSettingsService(
      prismaFixture(transaction),
      new ConfigurationRegistry(),
    );

    await expect(
      service.writeGlobal("admin-1", "platform.branding", globalSetting.value, {
        mode: "update",
        version: 1,
      }),
    ).resolves.toEqual(updated);
    expect(transaction.globalSetting.updateMany).toHaveBeenCalledWith({
      data: { value: globalSetting.value, version: { increment: 1 } },
      where: { key: "platform.branding", version: 1 },
    });
  });

  it("rejects stale updates and concurrent creation", async () => {
    const transaction = {
      globalSetting: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
    const prisma = prismaFixture(transaction);
    const service = new ConfigurationSettingsService(prisma, new ConfigurationRegistry());

    await expect(
      service.writeGlobal("admin-1", "platform.branding", globalSetting.value, {
        mode: "update",
        version: 9,
      }),
    ).rejects.toBeInstanceOf(SettingPreconditionFailedError);

    const conflict = new Prisma.PrismaClientKnownRequestError("duplicate", {
      clientVersion: "7.10.0",
      code: "P2002",
    });
    vi.mocked(prisma.$transaction).mockRejectedValueOnce(conflict);
    await expect(
      service.writeGlobal("admin-1", "platform.branding", globalSetting.value, {
        mode: "create",
      }),
    ).rejects.toBeInstanceOf(SettingPreconditionFailedError);
  });

  it("creates site configuration in its own scope with an isolated audit identity", async () => {
    const transaction = {
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
      siteSetting: { create: vi.fn().mockResolvedValue(siteSetting) },
    };
    const service = new ConfigurationSettingsService(
      prismaFixture(transaction),
      new ConfigurationRegistry(),
    );

    await expect(
      service.writeSite(
        "editor-1",
        "site-1",
        "site.identity",
        { displayName: "  Main Site  " },
        { mode: "create" },
      ),
    ).resolves.toEqual(siteSetting);
    expect(transaction.siteSetting.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          key: "site.identity",
          siteId: "site-1",
          value: { displayName: "Main Site" },
        },
      }),
    );
    expect(transaction.auditEvent.create).toHaveBeenCalledWith({
      data: {
        action: "configuration.site.written",
        actorId: "editor-1",
        entity: "SiteSetting",
        entityId: "site-1:site.identity",
        metadata: {
          key: "site.identity",
          previousVersion: null,
          siteId: "site-1",
          version: 1,
        },
      },
    });
  });
});
