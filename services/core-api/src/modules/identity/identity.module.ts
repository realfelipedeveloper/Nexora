import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module.js";
import { IDENTITY_CONFIGURATION, identityConfiguration } from "./identity.config.js";
import { IdentityController } from "./identity.controller.js";
import { IdentityService } from "./identity.service.js";
import { SessionAuthenticationGuard } from "./session-authentication.guard.js";
import { SiteAccessController } from "./site-access.controller.js";
import { SiteAccessService } from "./site-access.service.js";
import { SiteAuthorizationGuard } from "./site-authorization.guard.js";

@Module({
  controllers: [IdentityController, SiteAccessController],
  imports: [DatabaseModule],
  providers: [
    IdentityService,
    SessionAuthenticationGuard,
    SiteAccessService,
    SiteAuthorizationGuard,
    {
      provide: IDENTITY_CONFIGURATION,
      useFactory: identityConfiguration,
    },
  ],
})
export class IdentityModule {}
