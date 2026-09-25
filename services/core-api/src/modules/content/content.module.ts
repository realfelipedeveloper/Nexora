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
import { ContentVersioningController } from "./content-versioning.controller.js";
import { ContentVersioningService } from "./content-versioning.service.js";
import { SectionPlacementsController, SectionsController } from "./section-placement.controller.js";
import { SectionPlacementService } from "./section-placement.service.js";
import {
  MenusController,
  PublicNavigationController,
  RedirectsController,
  RoutesController,
} from "./navigation-routing.controller.js";
import { NavigationRoutingService } from "./navigation-routing.service.js";

@Module({
  controllers: [
    ContentCollaborationController,
    ContentEntriesController,
    ContentTypesController,
    ContentVersioningController,
    PublicContentController,
    PublicNavigationController,
    MenusController,
    RedirectsController,
    RoutesController,
    SectionPlacementsController,
    SectionsController,
  ],
  exports: [
    ContentAdminService,
    ContentCollaborationService,
    ContentFieldValidator,
    ContentMetrics,
    ContentVersioningService,
    PublicContentService,
    NavigationRoutingService,
    SectionPlacementService,
  ],
  imports: [DatabaseModule, IdentityModule],
  providers: [
    ContentAdminService,
    ContentCollaborationService,
    ContentFieldValidator,
    ContentMetrics,
    ContentVersioningService,
    PublicContentService,
    NavigationRoutingService,
    SectionPlacementService,
  ],
})
export class ContentModule {}
