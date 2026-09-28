import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { ConfigurationRegistry } from "./configuration-registry.js";
import {
  GlobalSettingsController,
  SiteSettingsController,
} from "./configuration-settings.controller.js";
import { ConfigurationSettingsService } from "./configuration-settings.service.js";
import { PublicConfigurationController } from "./public-configuration.controller.js";
import { PublicConfigurationService } from "./public-configuration.service.js";
import { SiteLifecycleService } from "./site-lifecycle.service.js";
import { SitesController } from "./sites.controller.js";
import { LocaleManagementController } from "./locale-management.controller.js";
import { LocaleManagementService } from "./locale-management.service.js";

@Module({
  controllers: [
    GlobalSettingsController,
    SiteSettingsController,
    SitesController,
    PublicConfigurationController,
    LocaleManagementController,
  ],
  exports: [ConfigurationRegistry, LocaleManagementService],
  imports: [DatabaseModule, IdentityModule],
  providers: [
    ConfigurationRegistry,
    ConfigurationSettingsService,
    PublicConfigurationService,
    SiteLifecycleService,
    LocaleManagementService,
  ],
})
export class SitesModule {}
