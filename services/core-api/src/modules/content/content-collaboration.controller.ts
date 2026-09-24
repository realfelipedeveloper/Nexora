import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpException,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UnsupportedMediaTypeException,
  UseGuards,
} from "@nestjs/common";
import { SessionCsrfGuard } from "../identity/administrative-guards.js";
import type { AuthenticatedRequest } from "../identity/session-authentication.guard.js";
import { SessionAuthenticationGuard } from "../identity/session-authentication.guard.js";
import {
  RequireSitePermissions,
  SiteAuthorizationGuard,
} from "../identity/site-authorization.guard.js";
import {
  ContentEntryNotFoundError,
  InvalidContentInputError,
  InvalidContentPageError,
} from "./content-admin.service.js";
import {
  ContentCollaborationService,
  ContentEntryAssigneeUnavailableError,
  ContentEntryAssignmentConflictError,
  ContentEntryAssignmentNotFoundError,
} from "./content-collaboration.service.js";

function requireJson(contentType: string | undefined) {
  if (contentType?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    throw new UnsupportedMediaTypeException("Content-Type must be application/json.");
  }
}

function actorId(request: AuthenticatedRequest) {
  if (!request.identity) {
    throw new HttpException("Authentication required.", 401);
  }
  return request.identity.user.id;
}

function mapCollaborationError(error: unknown): never {
  if (error instanceof InvalidContentInputError || error instanceof InvalidContentPageError) {
    throw new BadRequestException(error.message);
  }
  if (
    error instanceof ContentEntryNotFoundError ||
    error instanceof ContentEntryAssignmentNotFoundError ||
    error instanceof ContentEntryAssigneeUnavailableError
  ) {
    throw new NotFoundException(error.message);
  }
  if (error instanceof ContentEntryAssignmentConflictError) {
    throw new ConflictException(error.message);
  }
  throw error;
}

@Controller("sites/:siteId/content-entries/:contentEntryId")
@UseGuards(SessionAuthenticationGuard, SiteAuthorizationGuard)
export class ContentCollaborationController {
  constructor(
    @Inject(ContentCollaborationService)
    private readonly collaboration: ContentCollaborationService,
  ) {}

  @Get("assignments")
  @Header("Cache-Control", "no-store")
  @RequireSitePermissions("content.read")
  async listAssignments(
    @Param("siteId", new ParseUUIDPipe({ version: "4" })) siteId: string,
    @Param("contentEntryId", new ParseUUIDPipe({ version: "4" })) contentEntryId: string,
    @Query("limit") limit: string | undefined,
    @Query("cursor") cursor: string | undefined,
  ) {
    try {
      return await this.collaboration.listAssignments(siteId, contentEntryId, { cursor, limit });
    } catch (error) {
      mapCollaborationError(error);
    }
  }

  @Post("assignments")
  @Header("Cache-Control", "no-store")
  @RequireSitePermissions("content.publish")
  @UseGuards(SessionCsrfGuard)
  async createAssignment(
    @Req() request: AuthenticatedRequest,
    @Param("siteId", new ParseUUIDPipe({ version: "4" })) siteId: string,
    @Param("contentEntryId", new ParseUUIDPipe({ version: "4" })) contentEntryId: string,
    @Headers("content-type") contentType: string | undefined,
    @Body() body: unknown,
  ) {
    requireJson(contentType);
    try {
      return await this.collaboration.createAssignment(
        actorId(request),
        siteId,
        contentEntryId,
        body,
      );
    } catch (error) {
      mapCollaborationError(error);
    }
  }

  @Delete("assignments/:assignmentId")
  @HttpCode(204)
  @Header("Cache-Control", "no-store")
  @RequireSitePermissions("content.publish")
  @UseGuards(SessionCsrfGuard)
  async deleteAssignment(
    @Req() request: AuthenticatedRequest,
    @Param("siteId", new ParseUUIDPipe({ version: "4" })) siteId: string,
    @Param("contentEntryId", new ParseUUIDPipe({ version: "4" })) contentEntryId: string,
    @Param("assignmentId", new ParseUUIDPipe({ version: "4" })) assignmentId: string,
  ) {
    try {
      await this.collaboration.deleteAssignment(
        actorId(request),
        siteId,
        contentEntryId,
        assignmentId,
      );
    } catch (error) {
      mapCollaborationError(error);
    }
  }

  @Get("comments")
  @Header("Cache-Control", "no-store")
  @RequireSitePermissions("content.read")
  async listComments(
    @Param("siteId", new ParseUUIDPipe({ version: "4" })) siteId: string,
    @Param("contentEntryId", new ParseUUIDPipe({ version: "4" })) contentEntryId: string,
    @Query("limit") limit: string | undefined,
    @Query("cursor") cursor: string | undefined,
  ) {
    try {
      return await this.collaboration.listComments(siteId, contentEntryId, { cursor, limit });
    } catch (error) {
      mapCollaborationError(error);
    }
  }

  @Post("comments")
  @Header("Cache-Control", "no-store")
  @RequireSitePermissions("content.write")
  @UseGuards(SessionCsrfGuard)
  async createComment(
    @Req() request: AuthenticatedRequest,
    @Param("siteId", new ParseUUIDPipe({ version: "4" })) siteId: string,
    @Param("contentEntryId", new ParseUUIDPipe({ version: "4" })) contentEntryId: string,
    @Headers("content-type") contentType: string | undefined,
    @Body() body: unknown,
  ) {
    requireJson(contentType);
    try {
      return await this.collaboration.createComment(actorId(request), siteId, contentEntryId, body);
    } catch (error) {
      mapCollaborationError(error);
    }
  }
}
