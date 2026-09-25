import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { ContentMetrics } from "./content-metrics.js";
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

function delegate() {
  return {
    create: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    update: vi.fn(),
  };
}

function fixture() {
  const transaction = {
    auditEvent: delegate(),
    contentLocale: delegate(),
    locale: delegate(),
    menu: delegate(),
    menuItem: delegate(),
    redirect: delegate(),
    route: delegate(),
    routeAlias: delegate(),
    routingPath: delegate(),
  };
  const client = {
    $transaction: vi.fn(async (callback: (value: typeof transaction) => unknown) =>
      callback(transaction),
    ),
    menu: delegate(),
    menuItem: delegate(),
    redirect: delegate(),
    route: delegate(),
    routingPath: delegate(),
  };
  const metrics = {
    recordNavigationMutation: vi.fn(),
    recordRoutingResolution: vi.fn(),
  } as unknown as ContentMetrics;
  return {
    client,
    metrics,
    service: new NavigationRoutingService(client as unknown as PrismaClient, metrics),
    transaction,
  };
}

const localeId = "a11f740b-f15f-4279-8ca2-3877a4cae775";
const routeId = "2ec3cb32-e8c8-4c64-ad0f-8689e39a06a6";

describe("navigation routing service", () => {
  it("creates, updates, lists, retrieves, and deletes menus with audit", async () => {
    const { client, metrics, service, transaction } = fixture();
    const menu = { id: "menu-1", key: "main", locale: { id: localeId }, name: "Principal" };
    transaction.menu.create.mockResolvedValue(menu);
    transaction.menu.findUnique.mockResolvedValue({ id: "menu-1", localeId });
    transaction.menu.update.mockResolvedValue({ ...menu, name: "Topo" });
    transaction.menu.delete.mockResolvedValue(menu);
    client.menu.findUnique.mockResolvedValue(menu);
    client.menu.findMany.mockResolvedValue([menu]);

    await expect(
      service.createMenu("actor-1", "site-1", { key: "main", localeId, name: "Principal" }),
    ).resolves.toEqual(menu);
    await expect(
      service.updateMenu("actor-1", "site-1", "menu-1", { name: "Topo" }),
    ).resolves.toMatchObject({ name: "Topo" });
    await expect(service.getMenu("site-1", "menu-1")).resolves.toEqual(menu);
    await expect(service.listMenus("site-1", { limit: "10" })).resolves.toEqual({
      items: [menu],
      nextCursor: undefined,
    });
    await expect(service.deleteMenu("actor-1", "site-1", "menu-1")).resolves.toBeUndefined();
    expect(transaction.auditEvent.create).toHaveBeenCalledTimes(3);
    expect(metrics.recordNavigationMutation).toHaveBeenCalledWith("menu_deleted");
  });

  it("rejects malformed input, pagination, and absent menus", async () => {
    const { client, service } = fixture();
    await expect(service.createMenu("actor", "site", {})).rejects.toBeInstanceOf(
      InvalidNavigationInputError,
    );
    await expect(service.listMenus("site", { limit: "101" })).rejects.toBeInstanceOf(
      InvalidNavigationPageError,
    );
    await expect(service.listRoutes("site", { localeId: "invalid" })).rejects.toBeInstanceOf(
      InvalidNavigationPageError,
    );
    client.menu.findUnique.mockResolvedValue(null);
    await expect(service.getMenu("site", "missing")).rejects.toBeInstanceOf(MenuNotFoundError);
    client.menu.findFirst.mockResolvedValue(null);
    await expect(
      service.listMenus("site", { cursor: localeId, limit: "1" }),
    ).rejects.toBeInstanceOf(InvalidNavigationPageError);
  });

  it("creates internal and external menu items only inside menu scope", async () => {
    const { service, transaction } = fixture();
    transaction.menu.findUnique.mockResolvedValue({ id: "menu-1", localeId });
    transaction.route.findFirst.mockResolvedValue({ id: routeId });
    transaction.menuItem.findFirst.mockResolvedValue({ id: "parent-1" });
    transaction.menuItem.create.mockResolvedValue({ id: "item-1", linkType: "INTERNAL" });
    transaction.menuItem.update.mockResolvedValue({ id: "item-1", linkType: "EXTERNAL" });

    await expect(
      service.createMenuItem("actor", "site", "menu-1", {
        label: "Início",
        linkType: "INTERNAL",
        parentId: null,
        routeId,
      }),
    ).resolves.toMatchObject({ id: "item-1" });
    await expect(
      service.updateMenuItem("actor", "site", "menu-1", "item-1", {
        externalUrl: "https://example.com",
        label: "Externo",
        linkType: "EXTERNAL",
        parentId: "669762af-b0c2-4d2f-82a5-8a00354995c8",
      }),
    ).resolves.toMatchObject({ linkType: "EXTERNAL" });

    transaction.route.findFirst.mockResolvedValue(null);
    await expect(
      service.createMenuItem("actor", "site", "menu-1", {
        label: "Outra rota",
        linkType: "INTERNAL",
        routeId,
      }),
    ).rejects.toBeInstanceOf(NavigationConflictError);
  });

  it("paginates menu items and rejects invalid filters and missing mutations", async () => {
    const { client, service, transaction } = fixture();
    client.menu.findUnique.mockResolvedValue({ id: "menu-1", localeId });
    client.menuItem.findMany.mockResolvedValue([{ id: "item-1" }, { id: "item-2" }]);
    await expect(
      service.listMenuItems("site", "menu-1", { limit: "1", parentId: "root", visible: "true" }),
    ).resolves.toEqual({ items: [{ id: "item-1" }], nextCursor: "item-1" });
    await expect(
      service.listMenuItems("site", "menu-1", { visible: "maybe" }),
    ).rejects.toBeInstanceOf(InvalidNavigationPageError);
    await expect(
      service.listMenuItems("site", "menu-1", { parentId: "bad" }),
    ).rejects.toBeInstanceOf(InvalidNavigationPageError);
    transaction.menuItem.findFirst.mockResolvedValue(null);
    await expect(
      service.deleteMenuItem("actor", "site", "menu-1", "missing"),
    ).rejects.toBeInstanceOf(MenuItemNotFoundError);
  });

  it("creates a route and turns its previous slug into an alias on update", async () => {
    const { metrics, service, transaction } = fixture();
    transaction.locale.findUnique.mockResolvedValue({ id: localeId });
    transaction.contentLocale.findFirst.mockResolvedValue({ id: "localized" });
    transaction.routingPath.create
      .mockResolvedValueOnce({ id: "path-1" })
      .mockResolvedValueOnce({ id: "path-2" });
    transaction.route.create.mockResolvedValue({ id: routeId, path: { path: "/noticias" } });
    transaction.route.findUnique.mockResolvedValue({
      aliases: [],
      id: routeId,
      localeId,
      path: { path: "/noticias" },
      pathId: "path-1",
    });
    transaction.route.findUniqueOrThrow.mockResolvedValue({
      aliases: [{ path: { path: "/noticias" } }],
      id: routeId,
      path: { path: "/novidades" },
    });

    await expect(
      service.createRoute("actor", "site", { contentEntryId: null, localeId, path: "/noticias" }),
    ).resolves.toMatchObject({ id: routeId });
    await expect(
      service.updateRoute("actor", "site", routeId, {
        contentEntryId: null,
        path: "/novidades",
      }),
    ).resolves.toMatchObject({ id: routeId });
    expect(transaction.routingPath.update).toHaveBeenCalledWith({
      data: { kind: "ALIAS" },
      where: { id: "path-1" },
    });
    expect(transaction.routeAlias.create).toHaveBeenCalledWith({
      data: { localeId, pathId: "path-1", routeId, siteId: "site" },
    });
    expect(metrics.recordNavigationMutation).toHaveBeenCalledWith("route_updated");
  });

  it("lists, retrieves, updates without slug change, and deletes routes", async () => {
    const { client, service, transaction } = fixture();
    client.route.findMany.mockResolvedValue([{ id: routeId }]);
    client.route.findUnique.mockResolvedValue({ id: routeId });
    await expect(service.listRoutes("site", {})).resolves.toMatchObject({
      items: [{ id: routeId }],
    });
    await expect(service.getRoute("site", routeId)).resolves.toMatchObject({ id: routeId });

    transaction.route.findUnique.mockResolvedValue({
      aliases: [],
      id: routeId,
      localeId,
      path: { path: "/same" },
      pathId: "path-1",
    });
    transaction.locale.findUnique.mockResolvedValue({ id: localeId });
    transaction.route.findUniqueOrThrow.mockResolvedValue({ id: routeId, path: { path: "/same" } });
    await service.updateRoute("actor", "site", routeId, { contentEntryId: null, path: "/same" });
    expect(transaction.routeAlias.create).not.toHaveBeenCalled();

    transaction.route.findUnique.mockResolvedValue({
      aliases: [{ pathId: "old" }],
      id: routeId,
      pathId: "current",
    });
    await expect(service.deleteRoute("actor", "site", routeId)).resolves.toBeUndefined();
    expect(transaction.routingPath.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["current", "old"] }, siteId: "site" },
    });

    client.route.findUnique.mockResolvedValue(null);
    await expect(service.getRoute("site", "missing")).rejects.toBeInstanceOf(RouteNotFoundError);
  });

  it("creates bounded redirects and blocks loops", async () => {
    const { client, service, transaction } = fixture();
    transaction.locale.findUnique.mockResolvedValue({ id: localeId });
    transaction.redirect.findFirst.mockResolvedValueOnce({ targetPath: "/legacy" });
    await expect(
      service.createRedirect("actor", "site", {
        localeId,
        sourcePath: "/legacy",
        targetPath: "/old",
      }),
    ).rejects.toBeInstanceOf(NavigationConflictError);

    transaction.redirect.findFirst.mockResolvedValue(null);
    transaction.routingPath.create.mockResolvedValue({ id: "redirect-path" });
    transaction.redirect.create.mockResolvedValue({ id: "redirect-1", statusCode: 301 });
    await expect(
      service.createRedirect("actor", "site", {
        localeId,
        sourcePath: "/old",
        targetPath: "/new",
      }),
    ).resolves.toMatchObject({ id: "redirect-1" });

    client.redirect.findMany.mockResolvedValue([{ id: "redirect-1" }]);
    await expect(service.listRedirects("site", {})).resolves.toMatchObject({
      items: [{ id: "redirect-1" }],
    });
    transaction.redirect.findFirst.mockResolvedValue({
      id: "redirect-1",
      sourcePathId: "redirect-path",
    });
    await expect(service.deleteRedirect("actor", "site", "redirect-1")).resolves.toBeUndefined();
    transaction.redirect.findFirst.mockResolvedValue(null);
    await expect(service.deleteRedirect("actor", "site", "missing")).rejects.toBeInstanceOf(
      RedirectNotFoundError,
    );
  });

  it("resolves canonical, alias, redirect, draft, and absent public paths", async () => {
    const { client, metrics, service } = fixture();
    client.routingPath.findFirst
      .mockResolvedValueOnce({
        kind: "ROUTE",
        route: {
          contentEntry: { id: "entry", publishedProjections: [{ id: "projection" }] },
          id: routeId,
          path: { path: "/news" },
        },
      })
      .mockResolvedValueOnce({ alias: { route: { path: { path: "/news" } } }, kind: "ALIAS" })
      .mockResolvedValueOnce({
        kind: "REDIRECT",
        redirect: { statusCode: 308, targetPath: "/news" },
      })
      .mockResolvedValueOnce({
        kind: "ROUTE",
        route: {
          contentEntry: { id: "draft", publishedProjections: [] },
          id: routeId,
          path: { path: "/draft" },
        },
      })
      .mockResolvedValueOnce(null);

    await expect(service.resolvePublicRoute("site", "pt-BR", "/news")).resolves.toMatchObject({
      kind: "route",
    });
    await expect(service.resolvePublicRoute("site", "pt-BR", "/old")).resolves.toEqual({
      kind: "redirect",
      location: "/news",
      statusCode: 301,
    });
    await expect(service.resolvePublicRoute("site", "pt-BR", "/moved")).resolves.toEqual({
      kind: "redirect",
      location: "/news",
      statusCode: 308,
    });
    await expect(service.resolvePublicRoute("site", "pt-BR", "/draft")).resolves.toBeNull();
    await expect(service.resolvePublicRoute("site", "pt-BR", "/missing")).resolves.toBeNull();
    await expect(service.resolvePublicRoute("site", "pt-BR", "BAD")).rejects.toBeInstanceOf(
      InvalidNavigationInputError,
    );
    expect(metrics.recordRoutingResolution).toHaveBeenCalledWith("alias");
  });

  it("builds a visible public menu tree with internal and external targets", async () => {
    const { client, metrics, service } = fixture();
    client.menu.findFirst.mockResolvedValue({
      items: [
        {
          externalUrl: null,
          id: "parent",
          isVisible: true,
          label: "Parent",
          linkType: "INTERNAL",
          parentId: null,
          position: 0,
          route: { path: { path: "/parent" } },
        },
        {
          externalUrl: "https://example.com",
          id: "child",
          isVisible: true,
          label: "Child",
          linkType: "EXTERNAL",
          parentId: "parent",
          position: 0,
          route: null,
        },
      ],
      key: "main",
      locale: { code: "pt-BR" },
      name: "Principal",
    });
    const result = await service.getPublicMenu("site", "pt-BR", "main");
    expect(result?.items[0]).toMatchObject({ children: [{ id: "child" }], path: "/parent" });
    expect(metrics.recordRoutingResolution).toHaveBeenCalledWith("menu");
    client.menu.findFirst.mockResolvedValue(null);
    await expect(service.getPublicMenu("site", "pt-BR", "missing")).resolves.toBeNull();
  });
});
