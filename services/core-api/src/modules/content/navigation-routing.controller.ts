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
import type { AuthenticatedRequest } from "../identity/session-authentication.guard.js";
import { SessionAuthenticationGuard } from "../identity/session-authentication.guard.js";
import {
  RequireSitePermissions,
  SiteAuthorizationGuard,
} from "../identity/site-authorization.guard.js";
import {
  InvalidNavigationInputError,
  InvalidNavigationPageError,
  MenuItemNotFoundError,
  MenuNotFoundError,
  NavigationConflictError,
  NavigationRoutingService,
  RedirectNotFoundError,
  RouteNotFoundError,
} from "./navigation-routing.service.js";

function requireJson(contentType: string | undefined) {
  if (contentType?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    throw new UnsupportedMediaTypeException("Content-Type must be application/json.");
  }
}

function actorId(request: AuthenticatedRequest) {
  if (!request.identity) throw new HttpException("Authentication required.", 401);
  return request.identity.user.id;
}

function mapNavigationError(error: unknown): never {
  if (error instanceof InvalidNavigationInputError || error instanceof InvalidNavigationPageError) {
    throw new BadRequestException(error.message);
  }
  if (
    error instanceof MenuNotFoundError ||
    error instanceof MenuItemNotFoundError ||
    error instanceof RouteNotFoundError ||
    error instanceof RedirectNotFoundError
  ) {
    throw new NotFoundException(error.message);
  }
  if (error instanceof NavigationConflictError) throw new ConflictException(error.message);
  throw error;
}

@Controller("sites/:siteId/menus")
@UseGuards(SessionAuthenticationGuard, SiteAuthorizationGuard)
export class MenusController {
  constructor(
    @Inject(NavigationRoutingService) private readonly navigation: NavigationRoutingService,
  ) {}

  @Get()
  @Header("Cache-Control", "no-store")
  @RequireSitePermissions("content.read")
  async list(
    @Param("siteId", new ParseUUIDPipe({ version: "4" })) siteId: string,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
    @Query("localeId") localeId?: string,
  ) {
    try {
      return await this.navigation.listMenus(siteId, { cursor, limit, localeId });
    } catch (error) {
      mapNavigationError(error);
    }
  }

  @Get(":menuId")
  @Header("Cache-Control", "no-store")
  @RequireSitePermissions("content.read")
  async get(
    @Param("siteId", new ParseUUIDPipe({ version: "4" })) siteId: string,
    @Param("menuId", new ParseUUIDPipe({ version: "4" })) menuId: string,
  ) {
    try {
      return await this.navigation.getMenu(siteId, menuId);
    } catch (error) {
      mapNavigationError(error);
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
      return await this.navigation.createMenu(actorId(request), siteId, body);
    } catch (error) {
      mapNavigationError(error);
    }
  }

  @Put(":menuId")
  @Header("Cache-Control", "no-store")
  @RequireSitePermissions("content.write")
  @UseGuards(SessionCsrfGuard)
  async update(
    @Req() request: AuthenticatedRequest,
    @Param("siteId", new ParseUUIDPipe({ version: "4" })) siteId: string,
    @Param("menuId", new ParseUUIDPipe({ version: "4" })) menuId: string,
    @Headers("content-type") contentType: string | undefined,
    @Body() body: unknown,
  ) {
    requireJson(contentType);
    try {
      return await this.navigation.updateMenu(actorId(request), siteId, menuId, body);
    } catch (error) {
      mapNavigationError(error);
    }
  }

  @Delete(":menuId")
  @HttpCode(204)
  @Header("Cache-Control", "no-store")
  @RequireSitePermissions("content.write")
  @UseGuards(SessionCsrfGuard)
  async delete(
    @Req() request: AuthenticatedRequest,
    @Param("siteId", new ParseUUIDPipe({ version: "4" })) siteId: string,
    @Param("menuId", new ParseUUIDPipe({ version: "4" })) menuId: string,
  ) {
    try {
      await this.navigation.deleteMenu(actorId(request), siteId, menuId);
    } catch (error) {
      mapNavigationError(error);
    }
  }

  @Get(":menuId/items")
  @Header("Cache-Control", "no-store")
  @RequireSitePermissions("content.read")
  async listItems(
    @Param("siteId", new ParseUUIDPipe({ version: "4" })) siteId: string,
    @Param("menuId", new ParseUUIDPipe({ version: "4" })) menuId: string,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
    @Query("parentId") parentId?: string,
    @Query("visible") visible?: string,
  ) {
    try {
      return await this.navigation.listMenuItems(siteId, menuId, {
        cursor,
        limit,
        parentId,
        visible,
      });
    } catch (error) {
      mapNavigationError(error);
    }
  }

  @Post(":menuId/items")
  @Header("Cache-Control", "no-store")
  @RequireSitePermissions("content.write")
  @UseGuards(SessionCsrfGuard)
  async createItem(
    @Req() request: AuthenticatedRequest,
    @Param("siteId", new ParseUUIDPipe({ version: "4" })) siteId: string,
    @Param("menuId", new ParseUUIDPipe({ version: "4" })) menuId: string,
    @Headers("content-type") contentType: string | undefined,
    @Body() body: unknown,
  ) {
    requireJson(contentType);
    try {
      return await this.navigation.createMenuItem(actorId(request), siteId, menuId, body);
    } catch (error) {
      mapNavigationError(error);
    }
  }

  @Put(":menuId/items/:itemId")
  @Header("Cache-Control", "no-store")
  @RequireSitePermissions("content.write")
  @UseGuards(SessionCsrfGuard)
  async updateItem(
    @Req() request: AuthenticatedRequest,
    @Param("siteId", new ParseUUIDPipe({ version: "4" })) siteId: string,
    @Param("menuId", new ParseUUIDPipe({ version: "4" })) menuId: string,
    @Param("itemId", new ParseUUIDPipe({ version: "4" })) itemId: string,
    @Headers("content-type") contentType: string | undefined,
    @Body() body: unknown,
  ) {
    requireJson(contentType);
    try {
      return await this.navigation.updateMenuItem(actorId(request), siteId, menuId, itemId, body);
    } catch (error) {
      mapNavigationError(error);
    }
  }

  @Delete(":menuId/items/:itemId")
  @HttpCode(204)
  @Header("Cache-Control", "no-store")
  @RequireSitePermissions("content.write")
  @UseGuards(SessionCsrfGuard)
  async deleteItem(
    @Req() request: AuthenticatedRequest,
    @Param("siteId", new ParseUUIDPipe({ version: "4" })) siteId: string,
    @Param("menuId", new ParseUUIDPipe({ version: "4" })) menuId: string,
    @Param("itemId", new ParseUUIDPipe({ version: "4" })) itemId: string,
  ) {
    try {
      await this.navigation.deleteMenuItem(actorId(request), siteId, menuId, itemId);
    } catch (error) {
      mapNavigationError(error);
    }
  }
}

@Controller("sites/:siteId/routes")
@UseGuards(SessionAuthenticationGuard, SiteAuthorizationGuard)
export class RoutesController {
  constructor(
    @Inject(NavigationRoutingService) private readonly navigation: NavigationRoutingService,
  ) {}

  @Get()
  @Header("Cache-Control", "no-store")
  @RequireSitePermissions("content.read")
  async list(
    @Param("siteId", new ParseUUIDPipe({ version: "4" })) siteId: string,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
    @Query("localeId") localeId?: string,
  ) {
    try {
      return await this.navigation.listRoutes(siteId, { cursor, limit, localeId });
    } catch (error) {
      mapNavigationError(error);
    }
  }

  @Get(":routeId")
  @Header("Cache-Control", "no-store")
  @RequireSitePermissions("content.read")
  async get(
    @Param("siteId", new ParseUUIDPipe({ version: "4" })) siteId: string,
    @Param("routeId", new ParseUUIDPipe({ version: "4" })) routeId: string,
  ) {
    try {
      return await this.navigation.getRoute(siteId, routeId);
    } catch (error) {
      mapNavigationError(error);
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
      return await this.navigation.createRoute(actorId(request), siteId, body);
    } catch (error) {
      mapNavigationError(error);
    }
  }

  @Put(":routeId")
  @Header("Cache-Control", "no-store")
  @RequireSitePermissions("content.write")
  @UseGuards(SessionCsrfGuard)
  async update(
    @Req() request: AuthenticatedRequest,
    @Param("siteId", new ParseUUIDPipe({ version: "4" })) siteId: string,
    @Param("routeId", new ParseUUIDPipe({ version: "4" })) routeId: string,
    @Headers("content-type") contentType: string | undefined,
    @Body() body: unknown,
  ) {
    requireJson(contentType);
    try {
      return await this.navigation.updateRoute(actorId(request), siteId, routeId, body);
    } catch (error) {
      mapNavigationError(error);
    }
  }

  @Delete(":routeId")
  @HttpCode(204)
  @Header("Cache-Control", "no-store")
  @RequireSitePermissions("content.write")
  @UseGuards(SessionCsrfGuard)
  async delete(
    @Req() request: AuthenticatedRequest,
    @Param("siteId", new ParseUUIDPipe({ version: "4" })) siteId: string,
    @Param("routeId", new ParseUUIDPipe({ version: "4" })) routeId: string,
  ) {
    try {
      await this.navigation.deleteRoute(actorId(request), siteId, routeId);
    } catch (error) {
      mapNavigationError(error);
    }
  }
}

@Controller("sites/:siteId/redirects")
@UseGuards(SessionAuthenticationGuard, SiteAuthorizationGuard)
export class RedirectsController {
  constructor(
    @Inject(NavigationRoutingService) private readonly navigation: NavigationRoutingService,
  ) {}

  @Get()
  @Header("Cache-Control", "no-store")
  @RequireSitePermissions("content.read")
  async list(
    @Param("siteId", new ParseUUIDPipe({ version: "4" })) siteId: string,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
    @Query("localeId") localeId?: string,
  ) {
    try {
      return await this.navigation.listRedirects(siteId, { cursor, limit, localeId });
    } catch (error) {
      mapNavigationError(error);
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
      return await this.navigation.createRedirect(actorId(request), siteId, body);
    } catch (error) {
      mapNavigationError(error);
    }
  }

  @Delete(":redirectId")
  @HttpCode(204)
  @Header("Cache-Control", "no-store")
  @RequireSitePermissions("content.write")
  @UseGuards(SessionCsrfGuard)
  async delete(
    @Req() request: AuthenticatedRequest,
    @Param("siteId", new ParseUUIDPipe({ version: "4" })) siteId: string,
    @Param("redirectId", new ParseUUIDPipe({ version: "4" })) redirectId: string,
  ) {
    try {
      await this.navigation.deleteRedirect(actorId(request), siteId, redirectId);
    } catch (error) {
      mapNavigationError(error);
    }
  }
}

@Controller("public/sites/:siteKey")
export class PublicNavigationController {
  constructor(
    @Inject(NavigationRoutingService) private readonly navigation: NavigationRoutingService,
  ) {}

  @Get("navigation/:menuKey")
  @Header("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=60")
  async menu(
    @Param("siteKey") siteKey: string,
    @Param("menuKey") menuKey: string,
    @Query("locale") locale?: string,
  ) {
    if (!locale) throw new BadRequestException("Locale is required.");
    const menu = await this.navigation.getPublicMenu(siteKey, locale, menuKey);
    if (!menu) throw new NotFoundException("Public menu was not found.");
    return menu;
  }

  @Get("routes/resolve")
  @Header("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=60")
  async resolve(
    @Param("siteKey") siteKey: string,
    @Query("locale") locale?: string,
    @Query("path") path?: string,
  ) {
    if (!locale || !path) throw new BadRequestException("Locale and path are required.");
    try {
      const route = await this.navigation.resolvePublicRoute(siteKey, locale, path);
      if (!route) throw new NotFoundException("Public route was not found.");
      return route;
    } catch (error) {
      mapNavigationError(error);
    }
  }
}
