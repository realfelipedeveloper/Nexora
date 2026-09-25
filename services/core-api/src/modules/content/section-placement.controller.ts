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
  Put,
  Query,
  Req,
  UnsupportedMediaTypeException,
  UseGuards,
} from "@nestjs/common";
import { SessionCsrfGuard } from "../identity/administrative-guards.js";
import {
  RequireSectionPermissions,
  SectionAuthorizationGuard,
  type SectionScopedRequest,
} from "../identity/section-authorization.guard.js";
import type { AuthenticatedRequest } from "../identity/session-authentication.guard.js";
import { SessionAuthenticationGuard } from "../identity/session-authentication.guard.js";
import {
  RequireSitePermissions,
  SiteAuthorizationGuard,
} from "../identity/site-authorization.guard.js";
import {
  InvalidSectionInputError,
  InvalidSectionPageError,
  PlacementConflictError,
  PlacementNotFoundError,
  SectionConflictError,
  SectionMemberUnavailableError,
  SectionNotFoundError,
  SectionPlacementService,
  SectionRoleAssignmentConflictError,
  SectionRoleAssignmentNotFoundError,
} from "./section-placement.service.js";

function requireJson(contentType: string | undefined) {
  if (contentType?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    throw new UnsupportedMediaTypeException("Content-Type must be application/json.");
  }
}

function actorId(request: AuthenticatedRequest) {
  if (!request.identity) throw new HttpException("Authentication required.", 401);
  return request.identity.user.id;
}

function mapSectionError(error: unknown): never {
  if (error instanceof InvalidSectionInputError || error instanceof InvalidSectionPageError) {
    throw new BadRequestException(error.message);
  }
  if (
    error instanceof SectionNotFoundError ||
    error instanceof PlacementNotFoundError ||
    error instanceof SectionRoleAssignmentNotFoundError ||
    error instanceof SectionMemberUnavailableError
  ) {
    throw new NotFoundException(error.message);
  }
  if (
    error instanceof SectionConflictError ||
    error instanceof PlacementConflictError ||
    error instanceof SectionRoleAssignmentConflictError
  ) {
    throw new ConflictException(error.message);
  }
  throw error;
}

@Controller("sites/:siteId/sections")
@UseGuards(SessionAuthenticationGuard, SiteAuthorizationGuard)
export class SectionsController {
  constructor(
    @Inject(SectionPlacementService) private readonly sections: SectionPlacementService,
  ) {}

  @Get()
  @Header("Cache-Control", "no-store")
  @RequireSitePermissions("content.read")
  async list(
    @Param("siteId", new ParseUUIDPipe({ version: "4" })) siteId: string,
    @Query("limit") limit: string | undefined,
    @Query("cursor") cursor: string | undefined,
    @Query("parentId") parentId: string | undefined,
  ) {
    try {
      return await this.sections.listSections(siteId, { cursor, limit, parentId });
    } catch (error) {
      mapSectionError(error);
    }
  }

  @Get(":sectionId")
  @Header("Cache-Control", "no-store")
  @RequireSitePermissions("content.read")
  async get(
    @Param("siteId", new ParseUUIDPipe({ version: "4" })) siteId: string,
    @Param("sectionId", new ParseUUIDPipe({ version: "4" })) sectionId: string,
  ) {
    try {
      return await this.sections.getSection(siteId, sectionId);
    } catch (error) {
      mapSectionError(error);
    }
  }

  @Post()
  @Header("Cache-Control", "no-store")
  @RequireSitePermissions("content.write")
  @UseGuards(SessionCsrfGuard)
  async create(
    @Req() request: AuthenticatedRequest,
    @Param("siteId", new ParseUUIDPipe({ version: "4" })) siteId: string,
    @Headers("content-type") contentType: string | undefined,
    @Body() body: unknown,
  ) {
    requireJson(contentType);
    try {
      return await this.sections.createSection(actorId(request), siteId, body);
    } catch (error) {
      mapSectionError(error);
    }
  }

  @Put(":sectionId")
  @Header("Cache-Control", "no-store")
  @RequireSitePermissions("content.write")
  @UseGuards(SessionCsrfGuard)
  async update(
    @Req() request: AuthenticatedRequest,
    @Param("siteId", new ParseUUIDPipe({ version: "4" })) siteId: string,
    @Param("sectionId", new ParseUUIDPipe({ version: "4" })) sectionId: string,
    @Headers("content-type") contentType: string | undefined,
    @Body() body: unknown,
  ) {
    requireJson(contentType);
    try {
      return await this.sections.updateSection(actorId(request), siteId, sectionId, body);
    } catch (error) {
      mapSectionError(error);
    }
  }

  @Delete(":sectionId")
  @HttpCode(204)
  @Header("Cache-Control", "no-store")
  @RequireSitePermissions("content.write")
  @UseGuards(SessionCsrfGuard)
  async delete(
    @Req() request: AuthenticatedRequest,
    @Param("siteId", new ParseUUIDPipe({ version: "4" })) siteId: string,
    @Param("sectionId", new ParseUUIDPipe({ version: "4" })) sectionId: string,
  ) {
    try {
      await this.sections.deleteSection(actorId(request), siteId, sectionId);
    } catch (error) {
      mapSectionError(error);
    }
  }

  @Get(":sectionId/role-assignments")
  @Header("Cache-Control", "no-store")
  @RequireSitePermissions("members.read")
  async listRoleAssignments(
    @Param("siteId", new ParseUUIDPipe({ version: "4" })) siteId: string,
    @Param("sectionId", new ParseUUIDPipe({ version: "4" })) sectionId: string,
    @Query("limit") limit: string | undefined,
    @Query("cursor") cursor: string | undefined,
  ) {
    try {
      return await this.sections.listRoleAssignments(siteId, sectionId, { cursor, limit });
    } catch (error) {
      mapSectionError(error);
    }
  }

  @Post(":sectionId/role-assignments")
  @Header("Cache-Control", "no-store")
  @RequireSitePermissions("members.manage")
  @UseGuards(SessionCsrfGuard)
  async createRoleAssignment(
    @Req() request: AuthenticatedRequest,
    @Param("siteId", new ParseUUIDPipe({ version: "4" })) siteId: string,
    @Param("sectionId", new ParseUUIDPipe({ version: "4" })) sectionId: string,
    @Headers("content-type") contentType: string | undefined,
    @Body() body: unknown,
  ) {
    requireJson(contentType);
    try {
      return await this.sections.createRoleAssignment(actorId(request), siteId, sectionId, body);
    } catch (error) {
      mapSectionError(error);
    }
  }

  @Delete(":sectionId/role-assignments/:assignmentId")
  @HttpCode(204)
  @Header("Cache-Control", "no-store")
  @RequireSitePermissions("members.manage")
  @UseGuards(SessionCsrfGuard)
  async deleteRoleAssignment(
    @Req() request: AuthenticatedRequest,
    @Param("siteId", new ParseUUIDPipe({ version: "4" })) siteId: string,
    @Param("sectionId", new ParseUUIDPipe({ version: "4" })) sectionId: string,
    @Param("assignmentId", new ParseUUIDPipe({ version: "4" })) assignmentId: string,
  ) {
    try {
      await this.sections.deleteRoleAssignment(actorId(request), siteId, sectionId, assignmentId);
    } catch (error) {
      mapSectionError(error);
    }
  }
}

@Controller("sites/:siteId/sections/:sectionId/placements")
@UseGuards(SessionAuthenticationGuard, SectionAuthorizationGuard)
export class SectionPlacementsController {
  constructor(
    @Inject(SectionPlacementService) private readonly sections: SectionPlacementService,
  ) {}

  @Get()
  @Header("Cache-Control", "no-store")
  @RequireSectionPermissions("content.read")
  async list(
    @Param("siteId", new ParseUUIDPipe({ version: "4" })) siteId: string,
    @Param("sectionId", new ParseUUIDPipe({ version: "4" })) sectionId: string,
    @Query("limit") limit: string | undefined,
    @Query("cursor") cursor: string | undefined,
    @Query("visible") visible: string | undefined,
  ) {
    try {
      return await this.sections.listPlacements(siteId, sectionId, { cursor, limit, visible });
    } catch (error) {
      mapSectionError(error);
    }
  }

  @Put(":contentEntryId")
  @Header("Cache-Control", "no-store")
  @RequireSectionPermissions("content.write")
  @UseGuards(SessionCsrfGuard)
  async put(
    @Req() request: SectionScopedRequest,
    @Param("siteId", new ParseUUIDPipe({ version: "4" })) siteId: string,
    @Param("sectionId", new ParseUUIDPipe({ version: "4" })) sectionId: string,
    @Param("contentEntryId", new ParseUUIDPipe({ version: "4" })) contentEntryId: string,
    @Headers("content-type") contentType: string | undefined,
    @Body() body: unknown,
  ) {
    requireJson(contentType);
    try {
      return await this.sections.putPlacement(
        actorId(request),
        siteId,
        sectionId,
        contentEntryId,
        body,
      );
    } catch (error) {
      mapSectionError(error);
    }
  }

  @Delete(":contentEntryId")
  @HttpCode(204)
  @Header("Cache-Control", "no-store")
  @RequireSectionPermissions("content.write")
  @UseGuards(SessionCsrfGuard)
  async delete(
    @Req() request: SectionScopedRequest,
    @Param("siteId", new ParseUUIDPipe({ version: "4" })) siteId: string,
    @Param("sectionId", new ParseUUIDPipe({ version: "4" })) sectionId: string,
    @Param("contentEntryId", new ParseUUIDPipe({ version: "4" })) contentEntryId: string,
  ) {
    try {
      await this.sections.deletePlacement(actorId(request), siteId, sectionId, contentEntryId);
    } catch (error) {
      mapSectionError(error);
    }
  }
}
