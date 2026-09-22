import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { ContentEntriesController, ContentTypesController } from "./content-admin.controller.js";
import { ContentAdminService } from "./content-admin.service.js";
import { ContentFieldValidator } from "./content-field-validator.js";
import { ContentMetrics } from "./content-metrics.js";

@Module({
  controllers: [ContentEntriesController, ContentTypesController],
  exports: [ContentAdminService, ContentFieldValidator, ContentMetrics],
  imports: [DatabaseModule, IdentityModule],
  providers: [ContentAdminService, ContentFieldValidator, ContentMetrics],
})
export class ContentModule {}
