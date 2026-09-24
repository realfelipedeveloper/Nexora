import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { ContentEntriesController, ContentTypesController } from "./content-admin.controller.js";
import { ContentAdminService } from "./content-admin.service.js";
import { ContentCollaborationController } from "./content-collaboration.controller.js";
import { ContentCollaborationService } from "./content-collaboration.service.js";
import { ContentFieldValidator } from "./content-field-validator.js";
import { ContentMetrics } from "./content-metrics.js";
import { PublicContentController } from "./content-public.controller.js";
import { PublicContentService } from "./content-public.service.js";

@Module({
  controllers: [
    ContentCollaborationController,
    ContentEntriesController,
    ContentTypesController,
    PublicContentController,
  ],
  exports: [
    ContentAdminService,
    ContentCollaborationService,
    ContentFieldValidator,
    ContentMetrics,
    PublicContentService,
  ],
  imports: [DatabaseModule, IdentityModule],
  providers: [
    ContentAdminService,
    ContentCollaborationService,
    ContentFieldValidator,
    ContentMetrics,
    PublicContentService,
  ],
})
export class ContentModule {}
