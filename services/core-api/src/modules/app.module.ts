import { Module } from "@nestjs/common";
import { ContentModule } from "./content/content.module.js";
import { HealthController } from "./health.controller.js";
import { IdentityModule } from "./identity/identity.module.js";
import { SitesModule } from "./sites/sites.module.js";

@Module({
  controllers: [HealthController],
  imports: [ContentModule, IdentityModule, SitesModule],
})
export class AppModule {}
