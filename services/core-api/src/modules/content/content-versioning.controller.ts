import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Headers,
  HttpException,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  PreconditionFailedException,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { SessionCsrfGuard } from "../identity/administrative-guards.js";
import type { AuthenticatedRequest } from "../identity/session-authentication.guard.js";
import { SessionAuthenticationGuard } from "../identity/session-authentication.guard.js";
import {
  RequireSitePermissions,
  SiteAuthorizationGuard,
} from "../identity/site-authorization.guard.js";
import { parseContentPrecondition } from "./content-admin.controller.js";
import {
  ContentEntryNotFoundError,
  ContentPreconditionFailedError,
} from "./content-admin.service.js";
import {
  ContentEntryRevisionNotFoundError,
  ContentVersioningService,
  InvalidContentRevisionComparisonError,
  InvalidContentRevisionError,
} from "./content-versioning.service.js";

type HeaderResponse = { setHeader: (name: string, value: string) => void };

function actorId(request: AuthenticatedRequest) {
  if (!request.identity) {
    throw new HttpException("Authentication required.", 401);
  }
  return request.identity.user.id;
}

function mapVersioningError(error: unknown): never {
  if (
    error instanceof InvalidContentRevisionComparisonError ||
    error instanceof InvalidContentRevisionError
  ) {
    throw new BadRequestException(error.message);
  }
  if (error instanceof ContentEntryRevisionNotFoundError) {
    throw new NotFoundException(error.message);
  }
  if (error instanceof ContentEntryNotFoundError) {
    throw new NotFoundException(error.message);
  }
  if (error instanceof ContentPreconditionFailedError) {
    throw new PreconditionFailedException(error.message);
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

  @Post(":revision/restore")
  @Header("Cache-Control", "no-store")
  @RequireSitePermissions("content.write")
  @UseGuards(SessionCsrfGuard)
  async restore(
    @Req() request: AuthenticatedRequest,
    @Param("siteId", new ParseUUIDPipe({ version: "4" })) siteId: string,
    @Param("contentEntryId", new ParseUUIDPipe({ version: "4" })) contentEntryId: string,
    @Param("revision") revision: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Res({ passthrough: true }) response: HeaderResponse,
  ) {
    const expectedRevision = parseContentPrecondition(ifMatch);
    try {
      const restored = await this.versioning.restoreRevision(
        actorId(request),
        siteId,
        contentEntryId,
        revision,
        expectedRevision,
      );
      response.setHeader("ETag", `"${restored.revision}"`);
      return restored;
    } catch (error) {
      mapVersioningError(error);
    }
  }
}
