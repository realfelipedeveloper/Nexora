import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpException,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  PayloadTooLargeException,
  PreconditionFailedException,
  Post,
  Put,
  Query,
  Req,
  Res,
  UnsupportedMediaTypeException,
  UseGuards,
} from "@nestjs/common";
import { SessionCsrfGuard } from "../identity/administrative-guards.js";
import type { AuthenticatedRequest } from "../identity/session-authentication.guard.js";
import { SessionAuthenticationGuard } from "../identity/session-authentication.guard.js";
import {
  RequireSitePermissions,
  SiteAuthorizationGuard,
  type SiteScopedRequest,
} from "../identity/site-authorization.guard.js";
import {
  ContentAdminService,
  ContentEntryNotFoundError,
  ContentEntryStateConflictError,
  ContentEntryTransitionForbiddenError,
  ContentPreconditionFailedError,
  ContentTypeConflictError,
  ContentTypeInUseError,
  ContentTypeNotFoundError,
  InvalidContentInputError,
  InvalidContentPageError,
} from "./content-admin.service.js";
import { ContentDataInvalidError, ContentDataTooLargeError } from "./content-field-validator.js";

type HeaderResponse = { setHeader: (name: string, value: string) => void };
const maximumDatabaseInteger = 2_147_483_647;

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

function siteAccess(request: SiteScopedRequest) {
  if (!request.siteAccess) {
    throw new ForbiddenException("Site access denied.");
  }
  return request.siteAccess;
}

export function parseContentPrecondition(ifMatch: string | undefined) {
  const match = ifMatch?.match(/^"([1-9][0-9]*)"$/u);
  if (match?.[1]) {
    const version = Number(match[1]);
    if (Number.isSafeInteger(version) && version <= maximumDatabaseInteger) {
      return version;
    }
  }
  if (ifMatch) {
    throw new BadRequestException("Content version precondition is invalid.");
  }
  throw new HttpException("A content version precondition header is required.", 428);
}

function setVersion(response: HeaderResponse, version: number) {
  response.setHeader("ETag", `"${version}"`);
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
  if (error instanceof ContentEntryStateConflictError) {
    throw new ConflictException(error.message);
  }
  if (error instanceof ContentEntryTransitionForbiddenError) {
    throw new ForbiddenException(error.message);
  }
  if (error instanceof ContentPreconditionFailedError) {
    throw new PreconditionFailedException(error.message);
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
    @Res({ passthrough: true }) response: HeaderResponse,
  ) {
    try {
      const contentType = await this.content.getContentType(siteId, contentTypeId);
      setVersion(response, contentType.schemaVersion);
      return contentType;
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
    @Res({ passthrough: true }) response: HeaderResponse,
  ) {
    requireJson(contentType);
    try {
      const created = await this.content.createContentType(actorId(request), siteId, body);
      setVersion(response, created.schemaVersion);
      return created;
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
    @Headers("if-match") ifMatch: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: HeaderResponse,
  ) {
    requireJson(contentType);
    const expectedVersion = parseContentPrecondition(ifMatch);
    try {
      const updated = await this.content.updateContentType(
        actorId(request),
        siteId,
        contentTypeId,
        expectedVersion,
        body,
      );
      setVersion(response, updated.schemaVersion);
      return updated;
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
    @Headers("if-match") ifMatch: string | undefined,
  ) {
    const expectedVersion = parseContentPrecondition(ifMatch);
    try {
      await this.content.deleteContentType(
        actorId(request),
        siteId,
        contentTypeId,
        expectedVersion,
      );
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
    @Res({ passthrough: true }) response: HeaderResponse,
  ) {
    try {
      const entry = await this.content.getContentEntry(siteId, contentEntryId);
      setVersion(response, entry.revision);
      return entry;
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
    @Res({ passthrough: true }) response: HeaderResponse,
  ) {
    requireJson(contentType);
    try {
      const created = await this.content.createContentEntry(actorId(request), siteId, body);
      setVersion(response, created.revision);
      return created;
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
    @Headers("if-match") ifMatch: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: HeaderResponse,
  ) {
    requireJson(contentType);
    const expectedRevision = parseContentPrecondition(ifMatch);
    try {
      const updated = await this.content.updateContentEntry(
        actorId(request),
        siteId,
        contentEntryId,
        expectedRevision,
        body,
      );
      setVersion(response, updated.revision);
      return updated;
    } catch (error) {
      mapContentError(error);
    }
  }

  @Patch(":contentEntryId/status")
  @Header("Cache-Control", "no-store")
  @RequireSitePermissions("content.read")
  @UseGuards(SessionCsrfGuard)
  async updateStatus(
    @Req() request: SiteScopedRequest,
    @Param("siteId", new ParseUUIDPipe({ version: "4" })) siteId: string,
    @Param("contentEntryId", new ParseUUIDPipe({ version: "4" })) contentEntryId: string,
    @Headers("content-type") contentType: string | undefined,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: HeaderResponse,
  ) {
    requireJson(contentType);
    const expectedRevision = parseContentPrecondition(ifMatch);
    try {
      const updated = await this.content.updateContentEntryStatus(
        actorId(request),
        siteId,
        siteAccess(request),
        contentEntryId,
        expectedRevision,
        body,
      );
      setVersion(response, updated.revision);
      return updated;
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
    @Headers("if-match") ifMatch: string | undefined,
  ) {
    const expectedRevision = parseContentPrecondition(ifMatch);
    try {
      await this.content.deleteContentEntry(
        actorId(request),
        siteId,
        contentEntryId,
        expectedRevision,
      );
    } catch (error) {
      mapContentError(error);
    }
  }
}
