import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { ConfigurationRegistry } from "./configuration-registry.js";
import { SiteLifecycleService } from "./site-lifecycle.service.js";
import { SitesController } from "./sites.controller.js";

@Module({
  controllers: [SitesController],
  exports: [ConfigurationRegistry],
  imports: [DatabaseModule, IdentityModule],
  providers: [ConfigurationRegistry, SiteLifecycleService],
})
export class SitesModule {}
