import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Headers,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UnsupportedMediaTypeException,
  UseGuards,
} from "@nestjs/common";
import { SessionCsrfGuard, SystemAdministratorGuard } from "../identity/administrative-guards.js";
import type { AuthenticatedRequest } from "../identity/session-authentication.guard.js";
import { SessionAuthenticationGuard } from "../identity/session-authentication.guard.js";
import {
  RequireSitePermissions,
  SiteAuthorizationGuard,
} from "../identity/site-authorization.guard.js";
import {
  InvalidSiteLifecycleInputError,
  SiteKeyConflictError,
  SiteLifecycleService,
  SiteNotFoundError,
} from "./site-lifecycle.service.js";

function requireJson(contentType: string | undefined) {
  if (contentType?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    throw new UnsupportedMediaTypeException("Content-Type must be application/json.");
  }
}

function actor(request: AuthenticatedRequest) {
  if (!request.identity) {
    throw new ForbiddenException("Authenticated identity is required.");
  }
  return request.identity.user;
}

function mapLifecycleError(error: unknown): never {
  if (error instanceof InvalidSiteLifecycleInputError) {
    throw new BadRequestException(error.message);
  }
  if (error instanceof SiteKeyConflictError) {
    throw new ConflictException(error.message);
  }
  if (error instanceof SiteNotFoundError) {
    throw new NotFoundException(error.message);
  }
  throw error;
}

@Controller("sites")
@UseGuards(SessionAuthenticationGuard)
export class SitesController {
  constructor(@Inject(SiteLifecycleService) private readonly sites: SiteLifecycleService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  list(@Req() request: AuthenticatedRequest) {
    const identity = actor(request);
    return this.sites.listAccessible(identity.id, identity.isSystemAdmin);
  }

  @Post()
  @Header("Cache-Control", "no-store")
  @UseGuards(SystemAdministratorGuard, SessionCsrfGuard)
  async create(
    @Req() request: AuthenticatedRequest,
    @Headers("content-type") contentType: string | undefined,
    @Body() body: unknown,
  ) {
    requireJson(contentType);
    try {
      return await this.sites.create(actor(request).id, body);
    } catch (error) {
      mapLifecycleError(error);
    }
  }

  @Get(":siteId")
  @Header("Cache-Control", "no-store")
  @RequireSitePermissions("site.read")
  @UseGuards(SiteAuthorizationGuard)
  async get(@Param("siteId", new ParseUUIDPipe({ version: "4" })) siteId: string) {
    try {
      return await this.sites.get(siteId);
    } catch (error) {
      mapLifecycleError(error);
    }
  }

  @Patch(":siteId/status")
  @Header("Cache-Control", "no-store")
  @UseGuards(SystemAdministratorGuard, SessionCsrfGuard)
  async updateStatus(
    @Req() request: AuthenticatedRequest,
    @Param("siteId", new ParseUUIDPipe({ version: "4" })) siteId: string,
    @Headers("content-type") contentType: string | undefined,
    @Body() body: unknown,
  ) {
    requireJson(contentType);
    try {
      return await this.sites.updateStatus(actor(request).id, siteId, body);
    } catch (error) {
      mapLifecycleError(error);
    }
  }
}
