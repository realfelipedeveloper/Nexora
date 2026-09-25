import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module.js";
import { SessionCsrfGuard, SystemAdministratorGuard } from "./administrative-guards.js";
import { IDENTITY_CONFIGURATION, identityConfiguration } from "./identity.config.js";
import { IdentityController } from "./identity.controller.js";
import { IdentityService } from "./identity.service.js";
import { SessionAuthenticationGuard } from "./session-authentication.guard.js";
import { SectionAccessService } from "./section-access.service.js";
import { SectionAuthorizationGuard } from "./section-authorization.guard.js";
import { SiteAccessController } from "./site-access.controller.js";
import { SiteAccessService } from "./site-access.service.js";
import { SiteAuthorizationGuard } from "./site-authorization.guard.js";

@Module({
  controllers: [IdentityController, SiteAccessController],
  exports: [
    IDENTITY_CONFIGURATION,
    IdentityService,
    SessionAuthenticationGuard,
    SessionCsrfGuard,
    SectionAccessService,
    SectionAuthorizationGuard,
    SiteAccessService,
    SiteAuthorizationGuard,
    SystemAdministratorGuard,
  ],
  imports: [DatabaseModule],
  providers: [
    IdentityService,
    SessionAuthenticationGuard,
    SessionCsrfGuard,
    SectionAccessService,
    SectionAuthorizationGuard,
    SiteAccessService,
    SiteAuthorizationGuard,
    SystemAdministratorGuard,
    {
      provide: IDENTITY_CONFIGURATION,
      useFactory: identityConfiguration,
    },
  ],
})
export class IdentityModule {}
