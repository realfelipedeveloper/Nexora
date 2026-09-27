export type SiteSection = {
  createdAt: string;
  id: string;
  key: string;
  name: string;
  parentId: string | null;
  updatedAt: string;
};

export type ContentPlacement = {
  contentEntryId: string;
  createdAt: string;
  id: string;
  isPrimary: boolean;
  isVisible: boolean;
  position: number;
  sectionId: string;
  updatedAt: string;
};

export type SiteRoute = {
  aliases: Array<{ createdAt: string; id: string; path: { path: string } }>;
  contentEntryId: string | null;
  createdAt: string;
  id: string;
  locale: { code: string; id: string };
  path: { path: string };
  updatedAt: string;
};

export type SiteMenu = {
  createdAt: string;
  id: string;
  key: string;
  locale: { code: string; id: string };
  name: string;
  updatedAt: string;
};

export type MenuItem = {
  createdAt: string;
  externalUrl: string | null;
  id: string;
  isVisible: boolean;
  label: string;
  linkType: "EXTERNAL" | "INTERNAL";
  parentId: string | null;
  position: number;
  route: { id: string; path: { path: string } } | null;
  routeId: string | null;
  updatedAt: string;
};

type Page<Value> = { items: Value[]; nextCursor?: string };

export class SiteStructureApiError extends Error {
  override readonly name = "SiteStructureApiError";

  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function responseError(response: Response) {
  try {
    const value: unknown = await response.json();
    return isRecord(value) && typeof value.message === "string"
      ? value.message
      : "The site structure request could not be completed.";
  } catch {
    return "The site structure request could not be completed.";
  }
}

async function request<Value>(path: string, init: RequestInit = {}): Promise<Value> {
  const response = await fetch(`/api/core${path}`, {
    ...init,
    cache: "no-store",
    credentials: "include",
  });
  if (!response.ok) {
    throw new SiteStructureApiError(response.status, await responseError(response));
  }
  if (response.status === 204) return undefined as Value;
  return response.json() as Promise<Value>;
}

function write<Value>(
  path: string,
  csrfToken: string,
  method: "DELETE" | "POST" | "PUT",
  body?: unknown,
) {
  return request<Value>(path, {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      "x-csrf-token": csrfToken,
    },
    method,
  });
}

export function siteStructureErrorMessage(error: unknown) {
  if (error instanceof SiteStructureApiError) {
    if (error.status === 403) return "You do not have permission to manage site structure.";
    if (error.status === 409) return error.message;
    if (error.status === 400) return "Review the structure fields and try again.";
  }
  return "Site structure is unavailable right now. Try again.";
}

export function listSections(siteId: string) {
  return request<Page<SiteSection>>(`/sites/${siteId}/sections?limit=100`);
}

export function createSection(
  csrfToken: string,
  siteId: string,
  input: { key: string; name: string; parentId: string | null },
) {
  return write<SiteSection>(`/sites/${siteId}/sections`, csrfToken, "POST", input);
}

export function updateSection(
  csrfToken: string,
  siteId: string,
  sectionId: string,
  input: { name: string; parentId: string | null },
) {
  return write<SiteSection>(`/sites/${siteId}/sections/${sectionId}`, csrfToken, "PUT", input);
}

export function deleteSection(csrfToken: string, siteId: string, sectionId: string) {
  return write<undefined>(`/sites/${siteId}/sections/${sectionId}`, csrfToken, "DELETE");
}

export function listPlacements(siteId: string, sectionId: string) {
  return request<Page<ContentPlacement>>(
    `/sites/${siteId}/sections/${sectionId}/placements?limit=100`,
  );
}

export function savePlacement(
  csrfToken: string,
  siteId: string,
  sectionId: string,
  contentEntryId: string,
  input: { isPrimary: boolean; isVisible: boolean; position: number },
) {
  return write<ContentPlacement>(
    `/sites/${siteId}/sections/${sectionId}/placements/${contentEntryId}`,
    csrfToken,
    "PUT",
    input,
  );
}

export function deletePlacement(
  csrfToken: string,
  siteId: string,
  sectionId: string,
  contentEntryId: string,
) {
  return write<undefined>(
    `/sites/${siteId}/sections/${sectionId}/placements/${contentEntryId}`,
    csrfToken,
    "DELETE",
  );
}

export function listRoutes(siteId: string) {
  return request<Page<SiteRoute>>(`/sites/${siteId}/routes?limit=100`);
}

export function createRoute(
  csrfToken: string,
  siteId: string,
  input: { contentEntryId: string | null; localeId: string; path: string },
) {
  return write<SiteRoute>(`/sites/${siteId}/routes`, csrfToken, "POST", input);
}

export function updateRoute(
  csrfToken: string,
  siteId: string,
  routeId: string,
  input: { contentEntryId: string | null; path: string },
) {
  return write<SiteRoute>(`/sites/${siteId}/routes/${routeId}`, csrfToken, "PUT", input);
}

export function deleteRoute(csrfToken: string, siteId: string, routeId: string) {
  return write<undefined>(`/sites/${siteId}/routes/${routeId}`, csrfToken, "DELETE");
}

export function listMenus(siteId: string) {
  return request<Page<SiteMenu>>(`/sites/${siteId}/menus?limit=100`);
}

export function createMenu(
  csrfToken: string,
  siteId: string,
  input: { key: string; localeId: string; name: string },
) {
  return write<SiteMenu>(`/sites/${siteId}/menus`, csrfToken, "POST", input);
}

export function updateMenu(
  csrfToken: string,
  siteId: string,
  menuId: string,
  input: { name: string },
) {
  return write<SiteMenu>(`/sites/${siteId}/menus/${menuId}`, csrfToken, "PUT", input);
}

export function deleteMenu(csrfToken: string, siteId: string, menuId: string) {
  return write<undefined>(`/sites/${siteId}/menus/${menuId}`, csrfToken, "DELETE");
}

export function listMenuItems(siteId: string, menuId: string) {
  return request<Page<MenuItem>>(`/sites/${siteId}/menus/${menuId}/items?limit=100`);
}

export type MenuItemInput = {
  externalUrl: string | null;
  isVisible: boolean;
  label: string;
  linkType: MenuItem["linkType"];
  parentId: string | null;
  position: number;
  routeId: string | null;
};

export function createMenuItem(
  csrfToken: string,
  siteId: string,
  menuId: string,
  input: MenuItemInput,
) {
  return write<MenuItem>(`/sites/${siteId}/menus/${menuId}/items`, csrfToken, "POST", input);
}

export function updateMenuItem(
  csrfToken: string,
  siteId: string,
  menuId: string,
  itemId: string,
  input: MenuItemInput,
) {
  return write<MenuItem>(
    `/sites/${siteId}/menus/${menuId}/items/${itemId}`,
    csrfToken,
    "PUT",
    input,
  );
}

export function deleteMenuItem(csrfToken: string, siteId: string, menuId: string, itemId: string) {
  return write<undefined>(`/sites/${siteId}/menus/${menuId}/items/${itemId}`, csrfToken, "DELETE");
}
