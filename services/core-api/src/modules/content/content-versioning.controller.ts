import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from "@nestjs/common";
import { SessionAuthenticationGuard } from "../identity/session-authentication.guard.js";
import {
  RequireSitePermissions,
  SiteAuthorizationGuard,
} from "../identity/site-authorization.guard.js";
import {
  ContentEntryRevisionNotFoundError,
  ContentVersioningService,
  InvalidContentRevisionComparisonError,
} from "./content-versioning.service.js";

function mapVersioningError(error: unknown): never {
  if (error instanceof InvalidContentRevisionComparisonError) {
    throw new BadRequestException(error.message);
  }
  if (error instanceof ContentEntryRevisionNotFoundError) {
    throw new NotFoundException(error.message);
  }
  throw error;
}

@Controller("sites/:siteId/content-entries/:contentEntryId/revisions")
@UseGuards(SessionAuthenticationGuard, SiteAuthorizationGuard)
export class ContentVersioningController {
  constructor(
    @Inject(ContentVersioningService) private readonly versioning: ContentVersioningService,
  ) {}

  @Get("compare")
  @Header("Cache-Control", "no-store")
  @RequireSitePermissions("content.read")
  async compare(
    @Param("siteId", new ParseUUIDPipe({ version: "4" })) siteId: string,
    @Param("contentEntryId", new ParseUUIDPipe({ version: "4" })) contentEntryId: string,
    @Query("from") from: string | undefined,
    @Query("to") to: string | undefined,
  ) {
    try {
      return await this.versioning.compareRevisions(siteId, contentEntryId, { from, to });
    } catch (error) {
      mapVersioningError(error);
    }
  }
}
