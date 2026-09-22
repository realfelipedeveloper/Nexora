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
  PayloadTooLargeException,
  Post,
  Put,
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
  ContentAdminService,
  ContentEntryNotFoundError,
  ContentTypeConflictError,
  ContentTypeInUseError,
  ContentTypeNotFoundError,
  InvalidContentInputError,
  InvalidContentPageError,
} from "./content-admin.service.js";
import { ContentDataInvalidError, ContentDataTooLargeError } from "./content-field-validator.js";

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

function mapContentError(error: unknown): never {
  if (
    error instanceof InvalidContentInputError ||
    error instanceof InvalidContentPageError ||
    error instanceof ContentDataInvalidError
  ) {
    throw new BadRequestException(error.message);
  }
  if (error instanceof ContentDataTooLargeError) {
    throw new PayloadTooLargeException(error.message);
  }
  if (error instanceof ContentTypeNotFoundError || error instanceof ContentEntryNotFoundError) {
    throw new NotFoundException(error.message);
  }
  if (error instanceof ContentTypeConflictError || error instanceof ContentTypeInUseError) {
    throw new ConflictException(error.message);
  }
  throw error;
}

@Controller("sites/:siteId/content-types")
@UseGuards(SessionAuthenticationGuard, SiteAuthorizationGuard)
export class ContentTypesController {
  constructor(@Inject(ContentAdminService) private readonly content: ContentAdminService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  @RequireSitePermissions("content.read")
  async list(
    @Param("siteId", new ParseUUIDPipe({ version: "4" })) siteId: string,
    @Query("limit") limit: string | undefined,
    @Query("cursor") cursor: string | undefined,
  ) {
    try {
      return await this.content.listContentTypes(siteId, { cursor, limit });
    } catch (error) {
      mapContentError(error);
    }
  }

  @Get(":contentTypeId")
  @Header("Cache-Control", "no-store")
  @RequireSitePermissions("content.read")
  async get(
    @Param("siteId", new ParseUUIDPipe({ version: "4" })) siteId: string,
    @Param("contentTypeId", new ParseUUIDPipe({ version: "4" })) contentTypeId: string,
  ) {
    try {
      return await this.content.getContentType(siteId, contentTypeId);
    } catch (error) {
      mapContentError(error);
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
      return await this.content.createContentType(actorId(request), siteId, body);
    } catch (error) {
      mapContentError(error);
    }
  }

  @Put(":contentTypeId")
  @Header("Cache-Control", "no-store")
  @RequireSitePermissions("content.write")
  @UseGuards(SessionCsrfGuard)
  async update(
    @Req() request: AuthenticatedRequest,
    @Param("siteId", new ParseUUIDPipe({ version: "4" })) siteId: string,
    @Param("contentTypeId", new ParseUUIDPipe({ version: "4" })) contentTypeId: string,
    @Headers("content-type") contentType: string | undefined,
    @Body() body: unknown,
  ) {
    requireJson(contentType);
    try {
      return await this.content.updateContentType(actorId(request), siteId, contentTypeId, body);
    } catch (error) {
      mapContentError(error);
    }
  }

  @Delete(":contentTypeId")
  @HttpCode(204)
  @Header("Cache-Control", "no-store")
  @RequireSitePermissions("content.write")
  @UseGuards(SessionCsrfGuard)
  async delete(
    @Req() request: AuthenticatedRequest,
    @Param("siteId", new ParseUUIDPipe({ version: "4" })) siteId: string,
    @Param("contentTypeId", new ParseUUIDPipe({ version: "4" })) contentTypeId: string,
  ) {
    try {
      await this.content.deleteContentType(actorId(request), siteId, contentTypeId);
    } catch (error) {
      mapContentError(error);
    }
  }
}

@Controller("sites/:siteId/content-entries")
@UseGuards(SessionAuthenticationGuard, SiteAuthorizationGuard)
export class ContentEntriesController {
  constructor(@Inject(ContentAdminService) private readonly content: ContentAdminService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  @RequireSitePermissions("content.read")
  async list(
    @Param("siteId", new ParseUUIDPipe({ version: "4" })) siteId: string,
    @Query("limit") limit: string | undefined,
    @Query("cursor") cursor: string | undefined,
    @Query("contentTypeId") contentTypeId: string | undefined,
  ) {
    try {
      return await this.content.listContentEntries(siteId, { contentTypeId, cursor, limit });
    } catch (error) {
      mapContentError(error);
    }
  }

  @Get(":contentEntryId")
  @Header("Cache-Control", "no-store")
  @RequireSitePermissions("content.read")
  async get(
    @Param("siteId", new ParseUUIDPipe({ version: "4" })) siteId: string,
    @Param("contentEntryId", new ParseUUIDPipe({ version: "4" })) contentEntryId: string,
  ) {
    try {
      return await this.content.getContentEntry(siteId, contentEntryId);
    } catch (error) {
      mapContentError(error);
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
      return await this.content.createContentEntry(actorId(request), siteId, body);
    } catch (error) {
      mapContentError(error);
    }
  }

  @Put(":contentEntryId")
  @Header("Cache-Control", "no-store")
  @RequireSitePermissions("content.write")
  @UseGuards(SessionCsrfGuard)
  async update(
    @Req() request: AuthenticatedRequest,
    @Param("siteId", new ParseUUIDPipe({ version: "4" })) siteId: string,
    @Param("contentEntryId", new ParseUUIDPipe({ version: "4" })) contentEntryId: string,
    @Headers("content-type") contentType: string | undefined,
    @Body() body: unknown,
  ) {
    requireJson(contentType);
    try {
      return await this.content.updateContentEntry(actorId(request), siteId, contentEntryId, body);
    } catch (error) {
      mapContentError(error);
    }
  }

  @Delete(":contentEntryId")
  @HttpCode(204)
  @Header("Cache-Control", "no-store")
  @RequireSitePermissions("content.write")
  @UseGuards(SessionCsrfGuard)
  async delete(
    @Req() request: AuthenticatedRequest,
    @Param("siteId", new ParseUUIDPipe({ version: "4" })) siteId: string,
    @Param("contentEntryId", new ParseUUIDPipe({ version: "4" })) contentEntryId: string,
  ) {
    try {
      await this.content.deleteContentEntry(actorId(request), siteId, contentEntryId);
    } catch (error) {
      mapContentError(error);
    }
  }
}
