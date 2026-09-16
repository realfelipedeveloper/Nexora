import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import type { PublicSiteConfiguration } from "@nexora/contracts";
import { InjectPrismaClient } from "../../database/database.module.js";
import { ConfigurationRegistry } from "./configuration-registry.js";

type ConfigurationValue = Record<string, unknown>;

function isConfigurationValue(value: unknown): value is ConfigurationValue {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function valuesByKey(settings: readonly { key: string; value: unknown }[]) {
  return new Map(settings.map((setting) => [setting.key, setting.value]));
}

@Injectable()
export class PublicConfigurationService {
  constructor(
    @InjectPrismaClient() private readonly prisma: PrismaClient,
    @Inject(ConfigurationRegistry) private readonly registry: ConfigurationRegistry,
  ) {}

  async getSiteConfiguration(siteKey: string): Promise<PublicSiteConfiguration | null> {
    const [site, globalSettings] = await Promise.all([
      this.prisma.site.findFirst({
        select: {
          key: true,
          settings: {
            select: { key: true, value: true },
            where: { key: { in: [...this.registry.publicKeys("site")] } },
          },
        },
        where: { key: siteKey, status: "ACTIVE" },
      }),
      this.prisma.globalSetting.findMany({
        select: { key: true, value: true },
        where: { key: { in: [...this.registry.publicKeys("global")] } },
      }),
    ]);

    if (!site) {
      return null;
    }

    const configuration: PublicSiteConfiguration = { site: { key: site.key } };
    const globalValues = valuesByKey(globalSettings);
    const siteValues = valuesByKey(site.settings);
    const branding = globalValues.get("platform.branding");
    const identity = siteValues.get("site.identity");

    if (isConfigurationValue(branding)) {
      configuration.branding = this.registry.validateGlobal("platform.branding", branding);
    }
    if (isConfigurationValue(identity)) {
      configuration.site.identity = this.registry.validateSite("site.identity", identity);
    }

    return configuration;
  }
}
