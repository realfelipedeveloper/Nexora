import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpException,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  PayloadTooLargeException,
  PreconditionFailedException,
  Put,
  Req,
  Res,
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
  ConfigurationKeyNotRegisteredError,
  ConfigurationValueInvalidError,
  ConfigurationValueTooLargeError,
} from "./configuration-registry.js";
import {
  ConfigurationSettingsService,
  SettingNotFoundError,
  SettingPreconditionFailedError,
  type SettingPrecondition,
} from "./configuration-settings.service.js";

type HeaderResponse = { setHeader: (name: string, value: string) => void };

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

export function parseSettingPrecondition(
  ifMatch: string | undefined,
  ifNoneMatch: string | undefined,
): SettingPrecondition {
  if (ifMatch && ifNoneMatch) {
    throw new BadRequestException("Only one configuration precondition may be supplied.");
  }
  if (ifNoneMatch === "*") {
    return { mode: "create" };
  }
  const match = ifMatch?.match(/^"([1-9][0-9]*)"$/u);
  if (match?.[1]) {
    const version = Number(match[1]);
    if (Number.isSafeInteger(version)) {
      return { mode: "update", version };
    }
  }
  if (ifMatch || ifNoneMatch) {
    throw new BadRequestException("Configuration precondition is invalid.");
  }
  throw new HttpException("A configuration precondition header is required.", 428);
}

function setVersion(response: HeaderResponse, version: number) {
  response.setHeader("ETag", `"${version}"`);
}

function mapSettingError(error: unknown): never {
  if (
    error instanceof ConfigurationKeyNotRegisteredError ||
    error instanceof ConfigurationValueInvalidError
  ) {
    throw new BadRequestException(error.message);
  }
  if (error instanceof ConfigurationValueTooLargeError) {
    throw new PayloadTooLargeException(error.message);
  }
  if (error instanceof SettingNotFoundError) {
    throw new NotFoundException(error.message);
  }
  if (error instanceof SettingPreconditionFailedError) {
    throw new PreconditionFailedException(error.message);
  }
  throw error;
}

@Controller("settings/global")
@UseGuards(SessionAuthenticationGuard, SystemAdministratorGuard)
export class GlobalSettingsController {
  constructor(
    @Inject(ConfigurationSettingsService)
    private readonly settings: ConfigurationSettingsService,
  ) {}

  @Get()
  @Header("Cache-Control", "no-store")
  list() {
    return this.settings.listGlobal();
  }

  @Get(":key")
  @Header("Cache-Control", "no-store")
  async get(@Param("key") key: string, @Res({ passthrough: true }) response: HeaderResponse) {
    try {
      const setting = await this.settings.getGlobal(key);
      setVersion(response, setting.version);
      return setting;
    } catch (error) {
      mapSettingError(error);
    }
  }

  @Put(":key")
  @Header("Cache-Control", "no-store")
  @UseGuards(SessionCsrfGuard)
  async write(
    @Req() request: AuthenticatedRequest,
    @Param("key") key: string,
    @Headers("content-type") contentType: string | undefined,
    @Headers("if-match") ifMatch: string | undefined,
    @Headers("if-none-match") ifNoneMatch: string | undefined,
    @Body() value: unknown,
    @Res({ passthrough: true }) response: HeaderResponse,
  ) {
    requireJson(contentType);
    const precondition = parseSettingPrecondition(ifMatch, ifNoneMatch);
    try {
      const setting = await this.settings.writeGlobal(actorId(request), key, value, precondition);
      setVersion(response, setting.version);
      return setting;
    } catch (error) {
      mapSettingError(error);
    }
  }
}

@Controller("sites/:siteId/settings")
@UseGuards(SessionAuthenticationGuard, SiteAuthorizationGuard)
export class SiteSettingsController {
  constructor(
    @Inject(ConfigurationSettingsService)
    private readonly settings: ConfigurationSettingsService,
  ) {}

  @Get()
  @Header("Cache-Control", "no-store")
  @RequireSitePermissions("settings.read")
  list(@Param("siteId", new ParseUUIDPipe({ version: "4" })) siteId: string) {
    return this.settings.listSite(siteId);
  }

  @Get(":key")
  @Header("Cache-Control", "no-store")
  @RequireSitePermissions("settings.read")
  async get(
    @Param("siteId", new ParseUUIDPipe({ version: "4" })) siteId: string,
    @Param("key") key: string,
    @Res({ passthrough: true }) response: HeaderResponse,
  ) {
    try {
      const setting = await this.settings.getSite(siteId, key);
      setVersion(response, setting.version);
      return setting;
    } catch (error) {
      mapSettingError(error);
    }
  }

  @Put(":key")
  @Header("Cache-Control", "no-store")
  @RequireSitePermissions("settings.write")
  @UseGuards(SessionCsrfGuard)
  async write(
    @Req() request: AuthenticatedRequest,
    @Param("siteId", new ParseUUIDPipe({ version: "4" })) siteId: string,
    @Param("key") key: string,
    @Headers("content-type") contentType: string | undefined,
    @Headers("if-match") ifMatch: string | undefined,
    @Headers("if-none-match") ifNoneMatch: string | undefined,
    @Body() value: unknown,
    @Res({ passthrough: true }) response: HeaderResponse,
  ) {
    requireJson(contentType);
    const precondition = parseSettingPrecondition(ifMatch, ifNoneMatch);
    try {
      const setting = await this.settings.writeSite(
        actorId(request),
        siteId,
        key,
        value,
        precondition,
      );
      setVersion(response, setting.version);
      return setting;
    } catch (error) {
      mapSettingError(error);
    }
  }
}
