import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMenuItem,
  createRoute,
  listMenuItems,
  savePlacement,
  type MenuItemInput,
} from "./site-structure-api";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CMS site structure API", () => {
  it("places an entry inside the selected site and section with CSRF protection", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: "placement-1" }));
    vi.stubGlobal("fetch", fetchMock);

    await savePlacement("csrf-token", "site-1", "section-1", "entry-1", {
      isPrimary: true,
      isVisible: true,
      position: 2,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/core/sites/site-1/sections/section-1/placements/entry-1",
      {
        body: JSON.stringify({ isPrimary: true, isVisible: true, position: 2 }),
        cache: "no-store",
        credentials: "include",
        headers: { "Content-Type": "application/json", "x-csrf-token": "csrf-token" },
        method: "PUT",
      },
    );
  });

  it("creates a locale route without leaking the CSRF token into its body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: "route-1" }));
    vi.stubGlobal("fetch", fetchMock);

    await createRoute("csrf-token", "site-1", {
      contentEntryId: "entry-1",
      localeId: "locale-1",
      path: "/news",
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/core/sites/site-1/routes");
    expect(init.body).toBe(
      JSON.stringify({ contentEntryId: "entry-1", localeId: "locale-1", path: "/news" }),
    );
    expect(init.body).not.toContain("csrf-token");
    expect(init.headers).toEqual({
      "Content-Type": "application/json",
      "x-csrf-token": "csrf-token",
    });
  });

  it("keeps menu item reads and writes scoped to the selected menu", async () => {
    const item: MenuItemInput = {
      externalUrl: null,
      isVisible: true,
      label: "News",
      linkType: "INTERNAL",
      parentId: null,
      position: 0,
      routeId: "route-1",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ items: [] }))
      .mockResolvedValueOnce(jsonResponse({ id: "item-1" }));
    vi.stubGlobal("fetch", fetchMock);

    await listMenuItems("site-1", "menu-1");
    await createMenuItem("csrf-token", "site-1", "menu-1", item);

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/core/sites/site-1/menus/menu-1/items?limit=100",
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/core/sites/site-1/menus/menu-1/items");
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).body).toBe(JSON.stringify(item));
  });
});
