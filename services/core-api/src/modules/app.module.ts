import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller.js";
import { IdentityModule } from "./identity/identity.module.js";
import { SitesModule } from "./sites/sites.module.js";

@Module({
  controllers: [HealthController],
  imports: [IdentityModule, SitesModule],
})
export class AppModule {}
