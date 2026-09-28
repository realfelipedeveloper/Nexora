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
  Patch,
  Post,
  PreconditionFailedException,
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
} from "../identity/site-authorization.guard.js";
import {
  InvalidLocaleInputError,
  LocaleConflictError,
  LocaleManagementService,
  LocaleNotFoundError,
  LocalePreconditionFailedError,
} from "./locale-management.service.js";

type HeaderResponse = { setHeader(name: string, value: string): void };

function requireJson(contentType: string | undefined) {
  if (contentType?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    throw new UnsupportedMediaTypeException("Content-Type must be application/json.");
  }
}

function actorId(request: AuthenticatedRequest) {
  if (!request.identity) throw new HttpException("Authentication required.", 401);
  return request.identity.user.id;
}

function parseVersion(ifMatch: string | undefined) {
  const raw = ifMatch?.match(/^"([1-9][0-9]*)"$/u)?.[1];
  const version = raw ? Number(raw) : Number.NaN;
  if (Number.isSafeInteger(version)) return version;
  if (ifMatch) throw new BadRequestException("Locale version precondition is invalid.");
  throw new HttpException("A locale version precondition header is required.", 428);
}

function setVersion(response: HeaderResponse, version: number) {
  response.setHeader("ETag", `"${version}"`);
}

function mapLocaleError(error: unknown): never {
  if (error instanceof InvalidLocaleInputError) throw new BadRequestException(error.message);
  if (error instanceof LocaleNotFoundError) throw new NotFoundException(error.message);
  if (error instanceof LocaleConflictError) throw new ConflictException(error.message);
  if (error instanceof LocalePreconditionFailedError) {
    throw new PreconditionFailedException(error.message);
  }
  throw error;
}

@Controller("sites/:siteId/locales")
@UseGuards(SessionAuthenticationGuard, SiteAuthorizationGuard)
export class LocaleManagementController {
  constructor(@Inject(LocaleManagementService) private readonly locales: LocaleManagementService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  @RequireSitePermissions("settings.read")
  list(@Param("siteId", new ParseUUIDPipe({ version: "4" })) siteId: string) {
    return this.locales.list(siteId);
  }

  @Post()
  @Header("Cache-Control", "no-store")
  @RequireSitePermissions("settings.write")
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
      const locale = await this.locales.create(actorId(request), siteId, body);
      setVersion(response, locale.version);
      return locale;
    } catch (error) {
      mapLocaleError(error);
    }
  }

  @Patch(":localeId")
  @Header("Cache-Control", "no-store")
  @RequireSitePermissions("settings.write")
  @UseGuards(SessionCsrfGuard)
  async update(
    @Req() request: AuthenticatedRequest,
    @Param("siteId", new ParseUUIDPipe({ version: "4" })) siteId: string,
    @Param("localeId", new ParseUUIDPipe({ version: "4" })) localeId: string,
    @Headers("content-type") contentType: string | undefined,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: HeaderResponse,
  ) {
    requireJson(contentType);
    try {
      const locale = await this.locales.update(
        actorId(request),
        siteId,
        localeId,
        body,
        parseVersion(ifMatch),
      );
      setVersion(response, locale.version);
      return locale;
    } catch (error) {
      mapLocaleError(error);
    }
  }

  @Delete(":localeId")
  @HttpCode(204)
  @RequireSitePermissions("settings.write")
  @UseGuards(SessionCsrfGuard)
  async delete(
    @Req() request: AuthenticatedRequest,
    @Param("siteId", new ParseUUIDPipe({ version: "4" })) siteId: string,
    @Param("localeId", new ParseUUIDPipe({ version: "4" })) localeId: string,
    @Headers("if-match") ifMatch: string | undefined,
  ) {
    try {
      await this.locales.delete(actorId(request), siteId, localeId, parseVersion(ifMatch));
    } catch (error) {
      mapLocaleError(error);
    }
  }
}
