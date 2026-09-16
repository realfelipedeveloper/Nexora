import { Controller, Get, Header, Inject, NotFoundException, Param } from "@nestjs/common";
import { PublicConfigurationService } from "./public-configuration.service.js";

export const publicConfigurationCacheControl =
  "public, max-age=60, s-maxage=300, stale-while-revalidate=60";

@Controller("public/sites")
export class PublicConfigurationController {
  constructor(
    @Inject(PublicConfigurationService)
    private readonly configuration: PublicConfigurationService,
  ) {}

  @Get(":siteKey/configuration")
  @Header("Cache-Control", publicConfigurationCacheControl)
  async get(@Param("siteKey") siteKey: string) {
    const configuration = await this.configuration.getSiteConfiguration(siteKey);
    if (!configuration) {
      throw new NotFoundException("Public site configuration was not found.");
    }
    return configuration;
  }
}
