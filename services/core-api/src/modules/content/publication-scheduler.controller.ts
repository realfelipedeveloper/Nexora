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
  InvalidPublicationScheduleError,
  PublicationScheduleConflictError,
  PublicationScheduleNotFoundError,
  PublicationSchedulerService,
} from "./publication-scheduler.service.js";

function actorId(request: AuthenticatedRequest) {
  if (!request.identity) throw new HttpException("Authentication required.", 401);
  return request.identity.user.id;
}

function requireJson(contentType: string | undefined) {
  if (contentType?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    throw new UnsupportedMediaTypeException("Content-Type must be application/json.");
  }
}

function mapScheduleError(error: unknown): never {
  if (error instanceof InvalidPublicationScheduleError) {
    throw new BadRequestException(error.message);
  }
  if (error instanceof PublicationScheduleNotFoundError) {
    throw new NotFoundException(error.message);
  }
  if (error instanceof PublicationScheduleConflictError) {
    throw new ConflictException(error.message);
  }
  throw error;
}

@Controller("sites/:siteId/content-entries/:contentEntryId/publication-schedules")
@UseGuards(SessionAuthenticationGuard, SiteAuthorizationGuard)
export class PublicationSchedulesController {
  constructor(
    @Inject(PublicationSchedulerService)
    private readonly scheduler: PublicationSchedulerService,
  ) {}

  @Get()
  @Header("Cache-Control", "no-store")
  @RequireSitePermissions("content.read")
  async list(
    @Param("siteId", new ParseUUIDPipe({ version: "4" })) siteId: string,
    @Param("contentEntryId", new ParseUUIDPipe({ version: "4" })) contentEntryId: string,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ) {
    try {
      return await this.scheduler.list(siteId, contentEntryId, { cursor, limit });
    } catch (error) {
      mapScheduleError(error);
    }
  }

  @Post()
  @Header("Cache-Control", "no-store")
  @RequireSitePermissions("content.publish")
  @UseGuards(SessionCsrfGuard)
  async create(
    @Req() request: AuthenticatedRequest,
    @Param("siteId", new ParseUUIDPipe({ version: "4" })) siteId: string,
    @Param("contentEntryId", new ParseUUIDPipe({ version: "4" })) contentEntryId: string,
    @Headers("content-type") contentType: string | undefined,
    @Body() body: unknown,
  ) {
    requireJson(contentType);
    try {
      return await this.scheduler.create(actorId(request), siteId, contentEntryId, body);
    } catch (error) {
      mapScheduleError(error);
    }
  }

  @Delete(":scheduleId")
  @HttpCode(204)
  @Header("Cache-Control", "no-store")
  @RequireSitePermissions("content.publish")
  @UseGuards(SessionCsrfGuard)
  async cancel(
    @Req() request: AuthenticatedRequest,
    @Param("siteId", new ParseUUIDPipe({ version: "4" })) siteId: string,
    @Param("contentEntryId", new ParseUUIDPipe({ version: "4" })) contentEntryId: string,
    @Param("scheduleId", new ParseUUIDPipe({ version: "4" })) scheduleId: string,
  ) {
    try {
      await this.scheduler.cancel(actorId(request), siteId, contentEntryId, scheduleId);
    } catch (error) {
      mapScheduleError(error);
    }
  }
}
