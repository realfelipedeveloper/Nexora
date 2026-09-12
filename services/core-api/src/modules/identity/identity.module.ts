import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module.js";
import { IDENTITY_CONFIGURATION, identityConfiguration } from "./identity.config.js";
import { IdentityController } from "./identity.controller.js";
import { IdentityService } from "./identity.service.js";

@Module({
  controllers: [IdentityController],
  imports: [DatabaseModule],
  providers: [
    IdentityService,
    {
      provide: IDENTITY_CONFIGURATION,
      useFactory: identityConfiguration,
    },
  ],
})
export class IdentityModule {}
