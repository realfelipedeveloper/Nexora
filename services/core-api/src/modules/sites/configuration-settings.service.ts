import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import { InjectPrismaClient } from "../../database/database.module.js";
import {
  ConfigurationKeyNotRegisteredError,
  ConfigurationRegistry,
  type ConfigurationScope,
} from "./configuration-registry.js";

const settingSelection = {
  createdAt: true,
  key: true,
  updatedAt: true,
  value: true,
  version: true,
} as const;

export type SettingPrecondition = { mode: "create" } | { mode: "update"; version: number };

export class SettingNotFoundError extends Error {
  override readonly name = "SettingNotFoundError";

  constructor() {
    super("Configuration was not found.");
  }
}

export class SettingPreconditionFailedError extends Error {
  override readonly name = "SettingPreconditionFailedError";

  constructor() {
    super("Configuration version precondition failed.");
  }
}

function isPrismaError(error: unknown, code: string) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

function asJsonValue(value: unknown) {
  return value as Prisma.InputJsonValue;
}

@Injectable()
export class ConfigurationSettingsService {
  constructor(
    @InjectPrismaClient() private readonly prisma: PrismaClient,
    @Inject(ConfigurationRegistry) private readonly registry: ConfigurationRegistry,
  ) {}

  listGlobal() {
    return this.prisma.globalSetting.findMany({
      orderBy: { key: "asc" },
      select: settingSelection,
      where: { key: { in: [...this.registry.registeredKeys("global")] } },
    });
  }

  listSite(siteId: string) {
    return this.prisma.siteSetting.findMany({
      orderBy: { key: "asc" },
      select: settingSelection,
      where: {
        key: { in: [...this.registry.registeredKeys("site")] },
        siteId,
      },
    });
  }

  async getGlobal(key: string) {
    this.requireRegisteredKey("global", key);
    const setting = await this.prisma.globalSetting.findUnique({
      select: settingSelection,
      where: { key },
    });
    if (!setting) {
      throw new SettingNotFoundError();
    }
    return setting;
  }

  async getSite(siteId: string, key: string) {
    this.requireRegisteredKey("site", key);
    const setting = await this.prisma.siteSetting.findUnique({
      select: settingSelection,
      where: { siteId_key: { key, siteId } },
    });
    if (!setting) {
      throw new SettingNotFoundError();
    }
    return setting;
  }

  async writeGlobal(
    actorId: string,
    key: string,
    value: unknown,
    precondition: SettingPrecondition,
  ) {
    const validated = asJsonValue(this.registry.validateUnknown("global", key, value));

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const setting =
          precondition.mode === "create"
            ? await transaction.globalSetting.create({
                data: { key, value: validated },
                select: settingSelection,
              })
            : await this.updateGlobal(transaction, key, validated, precondition.version);

        await transaction.auditEvent.create({
          data: {
            action: "configuration.global.written",
            actorId,
            entity: "GlobalSetting",
            entityId: key,
            metadata: {
              key,
              previousVersion: precondition.mode === "create" ? null : precondition.version,
              version: setting.version,
            },
          },
        });
        return setting;
      });
    } catch (error) {
      if (isPrismaError(error, "P2002")) {
        throw new SettingPreconditionFailedError();
      }
      throw error;
    }
  }

  async writeSite(
    actorId: string,
    siteId: string,
    key: string,
    value: unknown,
    precondition: SettingPrecondition,
  ) {
    const validated = asJsonValue(this.registry.validateUnknown("site", key, value));

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const setting =
          precondition.mode === "create"
            ? await transaction.siteSetting.create({
                data: { key, siteId, value: validated },
                select: settingSelection,
              })
            : await this.updateSite(transaction, siteId, key, validated, precondition.version);

        await transaction.auditEvent.create({
          data: {
            action: "configuration.site.written",
            actorId,
            entity: "SiteSetting",
            entityId: `${siteId}:${key}`,
            metadata: {
              key,
              previousVersion: precondition.mode === "create" ? null : precondition.version,
              siteId,
              version: setting.version,
            },
          },
        });
        return setting;
      });
    } catch (error) {
      if (isPrismaError(error, "P2002")) {
        throw new SettingPreconditionFailedError();
      }
      throw error;
    }
  }

  private requireRegisteredKey(scope: ConfigurationScope, key: string) {
    if (!this.registry.registeredKeys(scope).includes(key)) {
      throw new ConfigurationKeyNotRegisteredError(scope);
    }
  }

  private async updateGlobal(
    transaction: Prisma.TransactionClient,
    key: string,
    value: Prisma.InputJsonValue,
    version: number,
  ) {
    const result = await transaction.globalSetting.updateMany({
      data: { value, version: { increment: 1 } },
      where: { key, version },
    });
    if (result.count !== 1) {
      throw new SettingPreconditionFailedError();
    }
    return transaction.globalSetting.findUniqueOrThrow({
      select: settingSelection,
      where: { key },
    });
  }

  private async updateSite(
    transaction: Prisma.TransactionClient,
    siteId: string,
    key: string,
    value: Prisma.InputJsonValue,
    version: number,
  ) {
    const result = await transaction.siteSetting.updateMany({
      data: { value, version: { increment: 1 } },
      where: { key, siteId, version },
    });
    if (result.count !== 1) {
      throw new SettingPreconditionFailedError();
    }
    return transaction.siteSetting.findUniqueOrThrow({
      select: settingSelection,
      where: { siteId_key: { key, siteId } },
    });
  }
}
