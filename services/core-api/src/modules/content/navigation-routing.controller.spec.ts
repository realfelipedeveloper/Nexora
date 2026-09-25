import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedRequest } from "../identity/session-authentication.guard.js";
import {
  MenusController,
  PublicNavigationController,
  RedirectsController,
  RoutesController,
} from "./navigation-routing.controller.js";
import {
  InvalidNavigationInputError,
  MenuNotFoundError,
  NavigationConflictError,
  type NavigationRoutingService,
} from "./navigation-routing.service.js";

const request = {
  headers: {},
  identity: {
    csrfToken: "csrf",
    expiresAt: new Date("2026-01-01T00:00:00Z"),
    sessionId: "session-1",
    user: {
      displayName: "Editor",
      email: "editor@example.com",
      id: "actor-1",
      isSystemAdmin: false,
    },
  },
} satisfies AuthenticatedRequest;

function fixture() {
  const service = {
    createMenu: vi.fn(),
    createMenuItem: vi.fn(),
    createRedirect: vi.fn(),
    createRoute: vi.fn(),
    deleteMenu: vi.fn(),
    deleteMenuItem: vi.fn(),
    deleteRedirect: vi.fn(),
    deleteRoute: vi.fn(),
    getMenu: vi.fn(),
    getPublicMenu: vi.fn(),
    getRoute: vi.fn(),
    listMenuItems: vi.fn(),
    listMenus: vi.fn(),
    listRedirects: vi.fn(),
    listRoutes: vi.fn(),
    resolvePublicRoute: vi.fn(),
    updateMenu: vi.fn(),
    updateMenuItem: vi.fn(),
    updateRoute: vi.fn(),
  };
  const navigation = service as unknown as NavigationRoutingService;
  return {
    menus: new MenusController(navigation),
    publicNavigation: new PublicNavigationController(navigation),
    redirects: new RedirectsController(navigation),
    routes: new RoutesController(navigation),
    service,
  };
}

describe("navigation routing controllers", () => {
  it("delegates all menu and menu-item operations with actor and filters", async () => {
    const { menus, service } = fixture();
    service.listMenus.mockResolvedValue({ items: [] });
    service.getMenu.mockResolvedValue({ id: "menu-1" });
    service.createMenu.mockResolvedValue({ id: "menu-1" });
    service.updateMenu.mockResolvedValue({ id: "menu-1" });
    service.listMenuItems.mockResolvedValue({ items: [] });
    service.createMenuItem.mockResolvedValue({ id: "item-1" });
    service.updateMenuItem.mockResolvedValue({ id: "item-1" });

    await menus.list("site", "10", "cursor", "locale");
    await menus.get("site", "menu-1");
    await menus.create(request, "site", "application/json; charset=utf-8", { key: "main" });
    await menus.update(request, "site", "menu-1", "application/json", { name: "Topo" });
    await menus.listItems("site", "menu-1", "20", "cursor", "root", "true");
    await menus.createItem(request, "site", "menu-1", "application/json", { label: "Home" });
    await menus.updateItem(request, "site", "menu-1", "item-1", "application/json", {
      label: "Início",
    });
    await menus.deleteItem(request, "site", "menu-1", "item-1");
    await menus.delete(request, "site", "menu-1");

    expect(service.listMenus).toHaveBeenCalledWith("site", {
      cursor: "cursor",
      limit: "10",
      localeId: "locale",
    });
    expect(service.createMenuItem).toHaveBeenCalledWith("actor-1", "site", "menu-1", {
      label: "Home",
    });
    expect(service.deleteMenu).toHaveBeenCalledWith("actor-1", "site", "menu-1");
  });

  it("delegates every route and redirect operation", async () => {
    const { redirects, routes, service } = fixture();
    service.listRoutes.mockResolvedValue({ items: [] });
    service.getRoute.mockResolvedValue({ id: "route-1" });
    service.createRoute.mockResolvedValue({ id: "route-1" });
    service.updateRoute.mockResolvedValue({ id: "route-1" });
    service.listRedirects.mockResolvedValue({ items: [] });
    service.createRedirect.mockResolvedValue({ id: "redirect-1" });

    await routes.list("site", "10", "cursor", "locale");
    await routes.get("site", "route-1");
    await routes.create(request, "site", "application/json", { path: "/home" });
    await routes.update(request, "site", "route-1", "application/json", { path: "/inicio" });
    await routes.delete(request, "site", "route-1");
    await redirects.list("site", "10", "cursor", "locale");
    await redirects.create(request, "site", "application/json", { sourcePath: "/old" });
    await redirects.delete(request, "site", "redirect-1");

    expect(service.updateRoute).toHaveBeenCalledWith("actor-1", "site", "route-1", {
      path: "/inicio",
    });
    expect(service.deleteRedirect).toHaveBeenCalledWith("actor-1", "site", "redirect-1");
  });

  it("rejects non-json mutations and maps domain errors", async () => {
    const { menus, routes, service } = fixture();
    await expect(menus.create(request, "site", "text/plain", {})).rejects.toBeInstanceOf(
      UnsupportedMediaTypeException,
    );

    service.getMenu.mockRejectedValue(new MenuNotFoundError());
    await expect(menus.get("site", "missing")).rejects.toBeInstanceOf(NotFoundException);
    service.listRoutes.mockRejectedValue(new InvalidNavigationInputError());
    await expect(routes.list("site")).rejects.toBeInstanceOf(BadRequestException);
    service.createRoute.mockRejectedValue(new NavigationConflictError());
    await expect(routes.create(request, "site", "application/json", {})).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("serves public menus and route resolutions with required query values", async () => {
    const { publicNavigation, service } = fixture();
    service.getPublicMenu.mockResolvedValue({ items: [], key: "main" });
    service.resolvePublicRoute.mockResolvedValue({ kind: "route" });
    await expect(publicNavigation.menu("site", "main", "pt-BR")).resolves.toMatchObject({
      key: "main",
    });
    await expect(publicNavigation.resolve("site", "pt-BR", "/home")).resolves.toMatchObject({
      kind: "route",
    });
    await expect(publicNavigation.menu("site", "main")).rejects.toBeInstanceOf(BadRequestException);
    await expect(publicNavigation.resolve("site", "pt-BR")).rejects.toBeInstanceOf(
      BadRequestException,
    );
    service.getPublicMenu.mockResolvedValue(null);
    await expect(publicNavigation.menu("site", "missing", "pt-BR")).rejects.toBeInstanceOf(
      NotFoundException,
    );
    service.resolvePublicRoute.mockResolvedValue(null);
    await expect(publicNavigation.resolve("site", "pt-BR", "/missing")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
