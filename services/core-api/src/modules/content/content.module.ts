import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { SitesModule } from "../sites/sites.module.js";
import {
  ContentEntriesController,
  ContentTypesController,
  EditorialContextController,
} from "./content-admin.controller.js";
import { ContentAdminService } from "./content-admin.service.js";
import { ContentCollaborationController } from "./content-collaboration.controller.js";
import { ContentCollaborationService } from "./content-collaboration.service.js";
import { ContentFieldValidator } from "./content-field-validator.js";
import { ContentMetrics } from "./content-metrics.js";
import { ContentPreviewController } from "./content-preview.controller.js";
import { ContentPreviewService } from "./content-preview.service.js";
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
import { PublicationSchedulesController } from "./publication-scheduler.controller.js";
import { PublicationSchedulerService } from "./publication-scheduler.service.js";
import { ContentAssetRelationService } from "./content-asset-relation.service.js";
import { MALWARE_SCANNER, ClamAvScanner } from "./malware-scanner.js";
import { MediaController, PublicMediaController } from "./media.controller.js";
import { MediaService } from "./media.service.js";
import { MEDIA_STORAGE, S3MediaStorage } from "./media-storage.js";

@Module({
  controllers: [
    ContentCollaborationController,
    ContentEntriesController,
    ContentTypesController,
    EditorialContextController,
    ContentVersioningController,
    ContentPreviewController,
    PublicContentController,
    PublicNavigationController,
    PublicationSchedulesController,
    MenusController,
    RedirectsController,
    RoutesController,
    SectionPlacementsController,
    SectionsController,
    MediaController,
    PublicMediaController,
  ],
  exports: [
    ContentAdminService,
    ContentCollaborationService,
    ContentFieldValidator,
    ContentMetrics,
    ContentVersioningService,
    ContentPreviewService,
    PublicContentService,
    NavigationRoutingService,
    PublicationSchedulerService,
    SectionPlacementService,
    ContentAssetRelationService,
    MediaService,
  ],
  imports: [DatabaseModule, IdentityModule, SitesModule],
  providers: [
    ContentAdminService,
    ContentCollaborationService,
    ContentFieldValidator,
    ContentMetrics,
    ContentVersioningService,
    ContentPreviewService,
    PublicContentService,
    NavigationRoutingService,
    PublicationSchedulerService,
    SectionPlacementService,
    ContentAssetRelationService,
    MediaService,
    { provide: MEDIA_STORAGE, useClass: S3MediaStorage },
    { provide: MALWARE_SCANNER, useClass: ClamAvScanner },
  ],
})
export class ContentModule {}
