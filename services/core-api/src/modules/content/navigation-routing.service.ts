import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  menuCreateSchema,
  menuItemWriteSchema,
  menuUpdateSchema,
  redirectCreateSchema,
  routeCreateSchema,
  routePathSchema,
  routeUpdateSchema,
  type MenuCreateInput,
  type MenuItemWriteInput,
  type MenuUpdateInput,
  type RedirectCreateInput,
  type RouteCreateInput,
  type RouteUpdateInput,
} from "@nexora/schemas";
import { InjectPrismaClient } from "../../database/database.module.js";
import { ContentMetrics } from "./content-metrics.js";

const defaultPageSize = 25;
const maximumPageSize = 100;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const menuSelection = {
  createdAt: true,
  id: true,
  key: true,
  locale: { select: { code: true, id: true } },
  name: true,
  updatedAt: true,
} as const;

const itemSelection = {
  createdAt: true,
  externalUrl: true,
  id: true,
  isVisible: true,
  label: true,
  linkType: true,
  parentId: true,
  position: true,
  route: { select: { id: true, path: { select: { path: true } } } },
  routeId: true,
  updatedAt: true,
} as const;

const routeSelection = {
  aliases: {
    orderBy: { createdAt: "desc" as const },
    select: { createdAt: true, id: true, path: { select: { path: true } } },
  },
  contentEntryId: true,
  createdAt: true,
  id: true,
  locale: { select: { code: true, id: true } },
  path: { select: { path: true } },
  updatedAt: true,
} as const;

export type NavigationPageInput = { cursor?: string; limit?: string };
export type MenuPageInput = NavigationPageInput & { localeId?: string };
export type MenuItemPageInput = NavigationPageInput & { parentId?: string; visible?: string };
export type RoutePageInput = NavigationPageInput & { localeId?: string };

export class InvalidNavigationInputError extends Error {
  override readonly name = "InvalidNavigationInputError";
  constructor() {
    super("Navigation or routing input is invalid.");
  }
}

export class InvalidNavigationPageError extends Error {
  override readonly name = "InvalidNavigationPageError";
  constructor() {
    super("Navigation pagination parameters are invalid.");
  }
}

export class MenuNotFoundError extends Error {
  override readonly name = "MenuNotFoundError";
  constructor() {
    super("Menu was not found.");
  }
}

export class MenuItemNotFoundError extends Error {
  override readonly name = "MenuItemNotFoundError";
  constructor() {
    super("Menu item was not found.");
  }
}

export class RouteNotFoundError extends Error {
  override readonly name = "RouteNotFoundError";
  constructor() {
    super("Route was not found.");
  }
}

export class RedirectNotFoundError extends Error {
  override readonly name = "RedirectNotFoundError";
  constructor() {
    super("Redirect was not found.");
  }
}
export class NavigationConflictError extends Error {
  override readonly name = "NavigationConflictError";
  constructor() {
    super("Navigation hierarchy, path, or target conflicts with existing data.");
  }
}

function parse<Input>(
  schema: { safeParse: (input: unknown) => { success: boolean; data?: Input } },
  input: unknown,
): Input {
  const result = schema.safeParse(input);
  if (!result.success) throw new InvalidNavigationInputError();
  return result.data as Input;
}

function parsePage(input: NavigationPageInput) {
  const rawLimit = input.limit ?? String(defaultPageSize);
  if (!/^[1-9][0-9]{0,2}$/u.test(rawLimit)) throw new InvalidNavigationPageError();
  const limit = Number(rawLimit);
  if (limit > maximumPageSize || (input.cursor && !uuidPattern.test(input.cursor))) {
    throw new InvalidNavigationPageError();
  }
  return { cursor: input.cursor, limit };
}

function isPrismaConflict(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    ["P2002", "P2003", "P2039"].includes(error.code)
  );
}

@Injectable()
export class NavigationRoutingService {
  constructor(
    @InjectPrismaClient() private readonly prisma: PrismaClient,
    @Inject(ContentMetrics) private readonly metrics: ContentMetrics,
  ) {}

  async listMenus(siteId: string, input: MenuPageInput) {
    const page = parsePage(input);
    this.validateOptionalUuid(input.localeId);
    await this.validateCursor(this.prisma.menu, page.cursor, { siteId });
    const records = await this.prisma.menu.findMany({
      cursor: page.cursor ? { id: page.cursor } : undefined,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: menuSelection,
      skip: page.cursor ? 1 : 0,
      take: page.limit + 1,
      where: { localeId: input.localeId, siteId },
    });
    return this.page(records, page.limit);
  }

  async getMenu(siteId: string, menuId: string) {
    const menu = await this.prisma.menu.findUnique({
      select: menuSelection,
      where: { id_siteId: { id: menuId, siteId } },
    });
    if (!menu) throw new MenuNotFoundError();
    return menu;
  }

  async createMenu(actorId: string, siteId: string, input: unknown) {
    const command = parse<MenuCreateInput>(menuCreateSchema, input);
    return this.write("menu_created", async (transaction) => {
      const menu = await transaction.menu.create({
        data: { ...command, siteId },
        select: menuSelection,
      });
      await this.audit(transaction, actorId, "navigation.menu.created", "Menu", menu.id, {
        siteId,
      });
      return menu;
    });
  }

  async updateMenu(actorId: string, siteId: string, menuId: string, input: unknown) {
    const command = parse<MenuUpdateInput>(menuUpdateSchema, input);
    return this.write("menu_updated", async (transaction) => {
      await this.requireMenu(transaction, siteId, menuId);
      const menu = await transaction.menu.update({
        data: command,
        select: menuSelection,
        where: { id: menuId },
      });
      await this.audit(transaction, actorId, "navigation.menu.updated", "Menu", menu.id, {
        siteId,
      });
      return menu;
    });
  }

  async deleteMenu(actorId: string, siteId: string, menuId: string) {
    await this.write("menu_deleted", async (transaction) => {
      await this.requireMenu(transaction, siteId, menuId);
      await transaction.menu.delete({ where: { id: menuId } });
      await this.audit(transaction, actorId, "navigation.menu.deleted", "Menu", menuId, { siteId });
    });
  }

  async listMenuItems(siteId: string, menuId: string, input: MenuItemPageInput) {
    const page = parsePage(input);
    const menu = await this.requireMenu(this.prisma, siteId, menuId);
    let parentId: string | null | undefined;
    if (input.parentId === "root") parentId = null;
    else if (input.parentId === undefined) parentId = undefined;
    else if (uuidPattern.test(input.parentId)) parentId = input.parentId;
    else throw new InvalidNavigationPageError();
    const isVisible =
      input.visible === undefined
        ? undefined
        : input.visible === "true"
          ? true
          : input.visible === "false"
            ? false
            : null;
    if (isVisible === null) throw new InvalidNavigationPageError();
    await this.validateCursor(this.prisma.menuItem, page.cursor, { menuId, siteId });
    const records = await this.prisma.menuItem.findMany({
      cursor: page.cursor ? { id: page.cursor } : undefined,
      orderBy: [{ position: "asc" }, { id: "asc" }],
      select: itemSelection,
      skip: page.cursor ? 1 : 0,
      take: page.limit + 1,
      where: { isVisible, menuId: menu.id, parentId, siteId },
    });
    return this.page(records, page.limit);
  }

  async createMenuItem(actorId: string, siteId: string, menuId: string, input: unknown) {
    const command = parse<MenuItemWriteInput>(menuItemWriteSchema, input);
    return this.write("item_created", async (transaction) => {
      const menu = await this.requireMenu(transaction, siteId, menuId);
      await this.requireItemTargets(transaction, menu, command);
      const item = await transaction.menuItem.create({
        data: { ...command, menuId, siteId },
        select: itemSelection,
      });
      await this.audit(transaction, actorId, "navigation.menu-item.created", "MenuItem", item.id, {
        menuId,
        siteId,
      });
      return item;
    });
  }

  async updateMenuItem(
    actorId: string,
    siteId: string,
    menuId: string,
    itemId: string,
    input: unknown,
  ) {
    const command = parse<MenuItemWriteInput>(menuItemWriteSchema, input);
    return this.write("item_updated", async (transaction) => {
      const menu = await this.requireMenu(transaction, siteId, menuId);
      await this.requireMenuItem(transaction, siteId, menuId, itemId);
      await this.requireItemTargets(transaction, menu, command);
      const item = await transaction.menuItem.update({
        data: command,
        select: itemSelection,
        where: { id: itemId },
      });
      await this.audit(transaction, actorId, "navigation.menu-item.updated", "MenuItem", item.id, {
        menuId,
        siteId,
      });
      return item;
    });
  }

  async deleteMenuItem(actorId: string, siteId: string, menuId: string, itemId: string) {
    await this.write("item_deleted", async (transaction) => {
      await this.requireMenuItem(transaction, siteId, menuId, itemId);
      await transaction.menuItem.delete({ where: { id: itemId } });
      await this.audit(transaction, actorId, "navigation.menu-item.deleted", "MenuItem", itemId, {
        menuId,
        siteId,
      });
    });
  }

  async listRoutes(siteId: string, input: RoutePageInput) {
    const page = parsePage(input);
    this.validateOptionalUuid(input.localeId);
    await this.validateCursor(this.prisma.route, page.cursor, { siteId });
    const records = await this.prisma.route.findMany({
      cursor: page.cursor ? { id: page.cursor } : undefined,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: routeSelection,
      skip: page.cursor ? 1 : 0,
      take: page.limit + 1,
      where: { localeId: input.localeId, siteId },
    });
    return this.page(records, page.limit);
  }

  async getRoute(siteId: string, routeId: string) {
    const route = await this.prisma.route.findUnique({
      select: routeSelection,
      where: { id_siteId: { id: routeId, siteId } },
    });
    if (!route) throw new RouteNotFoundError();
    return route;
  }

  async createRoute(actorId: string, siteId: string, input: unknown) {
    const command = parse<RouteCreateInput>(routeCreateSchema, input);
    return this.write("route_created", async (transaction) => {
      await this.requireRouteReferences(
        transaction,
        siteId,
        command.localeId,
        command.contentEntryId,
      );
      const path = await transaction.routingPath.create({
        data: { kind: "ROUTE", localeId: command.localeId, path: command.path, siteId },
      });
      const route = await transaction.route.create({
        data: {
          contentEntryId: command.contentEntryId,
          localeId: command.localeId,
          pathId: path.id,
          siteId,
        },
        select: routeSelection,
      });
      await this.audit(transaction, actorId, "routing.route.created", "Route", route.id, {
        path: command.path,
        siteId,
      });
      return route;
    });
  }

  async updateRoute(actorId: string, siteId: string, routeId: string, input: unknown) {
    const command = parse<RouteUpdateInput>(routeUpdateSchema, input);
    return this.write("route_updated", async (transaction) => {
      const current = await transaction.route.findUnique({
        include: { path: true },
        where: { id_siteId: { id: routeId, siteId } },
      });
      if (!current) throw new RouteNotFoundError();
      await this.requireRouteReferences(
        transaction,
        siteId,
        current.localeId,
        command.contentEntryId,
      );
      let pathId = current.pathId;
      if (command.path !== current.path.path) {
        const nextPath = await transaction.routingPath.create({
          data: { kind: "ROUTE", localeId: current.localeId, path: command.path, siteId },
        });
        pathId = nextPath.id;
        await transaction.route.update({
          data: { contentEntryId: command.contentEntryId, pathId },
          where: { id: routeId },
        });
        await transaction.routingPath.update({
          data: { kind: "ALIAS" },
          where: { id: current.pathId },
        });
        await transaction.routeAlias.create({
          data: { localeId: current.localeId, pathId: current.pathId, routeId, siteId },
        });
      } else {
        await transaction.route.update({
          data: { contentEntryId: command.contentEntryId },
          where: { id: routeId },
        });
      }
      const route = await transaction.route.findUniqueOrThrow({
        select: routeSelection,
        where: { id: routeId },
      });
      await this.audit(transaction, actorId, "routing.route.updated", "Route", route.id, {
        previousPath: current.path.path,
        path: command.path,
        siteId,
      });
      return route;
    });
  }

  async deleteRoute(actorId: string, siteId: string, routeId: string) {
    await this.write("route_deleted", async (transaction) => {
      const route = await transaction.route.findUnique({
        include: { aliases: { select: { pathId: true } } },
        where: { id_siteId: { id: routeId, siteId } },
      });
      if (!route) throw new RouteNotFoundError();
      await transaction.route.delete({ where: { id: route.id } });
      await transaction.routingPath.deleteMany({
        where: {
          id: { in: [route.pathId, ...route.aliases.map((alias) => alias.pathId)] },
          siteId,
        },
      });
      await this.audit(transaction, actorId, "routing.route.deleted", "Route", routeId, { siteId });
    });
  }

  async listRedirects(siteId: string, input: RoutePageInput) {
    const page = parsePage(input);
    this.validateOptionalUuid(input.localeId);
    await this.validateCursor(this.prisma.redirect, page.cursor, { siteId });
    const records = await this.prisma.redirect.findMany({
      cursor: page.cursor ? { id: page.cursor } : undefined,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        createdAt: true,
        id: true,
        locale: { select: { code: true, id: true } },
        sourcePath: { select: { path: true } },
        statusCode: true,
        targetPath: true,
        updatedAt: true,
      },
      skip: page.cursor ? 1 : 0,
      take: page.limit + 1,
      where: { localeId: input.localeId, siteId },
    });
    return this.page(records, page.limit);
  }

  async createRedirect(actorId: string, siteId: string, input: unknown) {
    const command = parse<RedirectCreateInput>(redirectCreateSchema, input);
    return this.write("redirect_created", async (transaction) => {
      await this.requireLocale(transaction, siteId, command.localeId);
      await this.assertRedirectAcyclic(
        transaction,
        siteId,
        command.localeId,
        command.sourcePath,
        command.targetPath,
      );
      const path = await transaction.routingPath.create({
        data: { kind: "REDIRECT", localeId: command.localeId, path: command.sourcePath, siteId },
      });
      const redirect = await transaction.redirect.create({
        data: {
          localeId: command.localeId,
          siteId,
          sourcePathId: path.id,
          statusCode: command.statusCode,
          targetPath: command.targetPath,
        },
        select: {
          id: true,
          sourcePath: { select: { path: true } },
          statusCode: true,
          targetPath: true,
        },
      });
      await this.audit(transaction, actorId, "routing.redirect.created", "Redirect", redirect.id, {
        siteId,
        sourcePath: command.sourcePath,
        targetPath: command.targetPath,
      });
      return redirect;
    });
  }

  async deleteRedirect(actorId: string, siteId: string, redirectId: string) {
    await this.write("redirect_deleted", async (transaction) => {
      const redirect = await transaction.redirect.findFirst({
        select: { id: true, sourcePathId: true },
        where: { id: redirectId, siteId },
      });
      if (!redirect) throw new RedirectNotFoundError();
      await transaction.redirect.delete({ where: { id: redirect.id } });
      await transaction.routingPath.delete({ where: { id: redirect.sourcePathId } });
      await this.audit(transaction, actorId, "routing.redirect.deleted", "Redirect", redirect.id, {
        siteId,
      });
    });
  }

  async resolvePublicRoute(siteKey: string, localeCode: string, rawPath: string) {
    const path = parse<string>(routePathSchema, rawPath);
    const routingPath = await this.prisma.routingPath.findFirst({
      include: {
        alias: { include: { route: { include: { path: true } } } },
        redirect: true,
        route: {
          include: {
            contentEntry: {
              select: {
                id: true,
                publishedProjections: {
                  select: { id: true },
                  take: 1,
                  where: { localeCode },
                },
              },
            },
            path: true,
          },
        },
      },
      where: { locale: { code: localeCode }, path, site: { key: siteKey, status: "ACTIVE" } },
    });
    if (!routingPath) return null;
    this.metrics.recordRoutingResolution(
      routingPath.kind.toLowerCase() as "alias" | "redirect" | "route",
    );
    if (routingPath.kind === "ALIAS" && routingPath.alias) {
      return {
        kind: "redirect" as const,
        location: routingPath.alias.route.path.path,
        statusCode: 301,
      };
    }
    if (routingPath.kind === "REDIRECT" && routingPath.redirect) {
      return {
        kind: "redirect" as const,
        location: routingPath.redirect.targetPath,
        statusCode: routingPath.redirect.statusCode,
      };
    }
    const route = routingPath.route;
    if (!route || (route.contentEntry && route.contentEntry.publishedProjections.length === 0)) {
      return null;
    }
    return {
      contentEntryId: route.contentEntry?.id ?? null,
      kind: "route" as const,
      path: route.path.path,
      routeId: route.id,
    };
  }

  async getPublicMenu(siteKey: string, localeCode: string, menuKey: string) {
    const menu = await this.prisma.menu.findFirst({
      include: {
        items: {
          include: { route: { include: { path: true } } },
          orderBy: [{ position: "asc" }, { id: "asc" }],
          where: { isVisible: true },
        },
        locale: { select: { code: true } },
      },
      where: {
        key: menuKey,
        locale: { code: localeCode },
        site: { key: siteKey, status: "ACTIVE" },
      },
    });
    if (!menu) return null;
    const items = menu.items.map((item) => ({
      children: [] as unknown[],
      externalUrl: item.externalUrl,
      id: item.id,
      label: item.label,
      linkType: item.linkType,
      parentId: item.parentId,
      path: item.route?.path.path ?? null,
      position: item.position,
    }));
    const byId = new Map(items.map((item) => [item.id, item]));
    const roots: typeof items = [];
    for (const item of items) {
      const parent = item.parentId ? byId.get(item.parentId) : undefined;
      if (parent) parent.children.push(item);
      else roots.push(item);
    }
    this.metrics.recordRoutingResolution("menu");
    return { items: roots, key: menu.key, locale: menu.locale.code, name: menu.name };
  }

  private async requireMenu(
    client: Prisma.TransactionClient | PrismaClient,
    siteId: string,
    menuId: string,
  ) {
    const menu = await client.menu.findUnique({
      select: { id: true, localeId: true },
      where: { id_siteId: { id: menuId, siteId } },
    });
    if (!menu) throw new MenuNotFoundError();
    return menu;
  }

  private async requireMenuItem(
    client: Prisma.TransactionClient,
    siteId: string,
    menuId: string,
    itemId: string,
  ) {
    const item = await client.menuItem.findFirst({
      select: { id: true },
      where: { id: itemId, menuId, siteId },
    });
    if (!item) throw new MenuItemNotFoundError();
    return item;
  }

  private async requireItemTargets(
    client: Prisma.TransactionClient,
    menu: { id: string; localeId: string },
    command: MenuItemWriteInput,
  ) {
    if (command.parentId) {
      const parent = await client.menuItem.findFirst({
        select: { id: true },
        where: { id: command.parentId, menuId: menu.id },
      });
      if (!parent) throw new NavigationConflictError();
    }
    if (command.routeId) {
      const route = await client.route.findFirst({
        select: { id: true },
        where: { id: command.routeId, localeId: menu.localeId },
      });
      if (!route) throw new NavigationConflictError();
    }
  }

  private async requireRouteReferences(
    client: Prisma.TransactionClient,
    siteId: string,
    localeId: string,
    contentEntryId: string | null,
  ) {
    await this.requireLocale(client, siteId, localeId);
    if (contentEntryId) {
      const locale = await client.contentLocale.findFirst({
        select: { id: true },
        where: { contentEntryId, localeId, siteId },
      });
      if (!locale) throw new NavigationConflictError();
    }
  }

  private async requireLocale(client: Prisma.TransactionClient, siteId: string, localeId: string) {
    const locale = await client.locale.findUnique({
      select: { id: true },
      where: { id_siteId: { id: localeId, siteId } },
    });
    if (!locale) throw new NavigationConflictError();
  }

  private async assertRedirectAcyclic(
    client: Prisma.TransactionClient,
    siteId: string,
    localeId: string,
    sourcePath: string,
    targetPath: string,
  ) {
    let current = targetPath;
    for (let depth = 0; depth < 32; depth += 1) {
      if (current === sourcePath) throw new NavigationConflictError();
      const next = await client.redirect.findFirst({
        select: { targetPath: true },
        where: { localeId, siteId, sourcePath: { path: current } },
      });
      if (!next) return;
      current = next.targetPath;
    }
    throw new NavigationConflictError();
  }

  private async validateCursor(
    delegate: { findFirst: (args: never) => Promise<unknown> },
    cursor: string | undefined,
    where: Record<string, string>,
  ) {
    if (
      cursor &&
      !(await delegate.findFirst({
        select: { id: true },
        where: { id: cursor, ...where },
      } as never))
    )
      throw new InvalidNavigationPageError();
  }

  private validateOptionalUuid(value: string | undefined) {
    if (value && !uuidPattern.test(value)) throw new InvalidNavigationPageError();
  }

  private async audit(
    client: Prisma.TransactionClient,
    actorId: string,
    action: string,
    entity: string,
    entityId: string,
    metadata: Prisma.InputJsonValue,
  ) {
    await client.auditEvent.create({ data: { action, actorId, entity, entityId, metadata } });
  }

  private async write<Result>(
    operation: Parameters<ContentMetrics["recordNavigationMutation"]>[0],
    callback: (client: Prisma.TransactionClient) => Promise<Result>,
  ) {
    try {
      const result = await this.prisma.$transaction(callback);
      this.metrics.recordNavigationMutation(operation);
      return result;
    } catch (error) {
      if (
        isPrismaConflict(error) ||
        (error instanceof Error && /hierarchy cycle|redirect loop/iu.test(error.message))
      )
        throw new NavigationConflictError();
      throw error;
    }
  }

  private page<Record extends { id: string }>(records: Record[], limit: number) {
    const hasNextPage = records.length > limit;
    const items = hasNextPage ? records.slice(0, limit) : records;
    return { items, nextCursor: hasNextPage ? items.at(-1)?.id : undefined };
  }
}
