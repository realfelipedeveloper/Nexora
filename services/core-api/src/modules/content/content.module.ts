import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { ContentEntriesController, ContentTypesController } from "./content-admin.controller.js";
import { ContentAdminService } from "./content-admin.service.js";
import { ContentFieldValidator } from "./content-field-validator.js";
import { ContentMetrics } from "./content-metrics.js";
import { PublicContentController } from "./content-public.controller.js";
import { PublicContentService } from "./content-public.service.js";

@Module({
  controllers: [ContentEntriesController, ContentTypesController, PublicContentController],
  exports: [ContentAdminService, ContentFieldValidator, ContentMetrics, PublicContentService],
  imports: [DatabaseModule, IdentityModule],
  providers: [ContentAdminService, ContentFieldValidator, ContentMetrics, PublicContentService],
})
export class ContentModule {}
