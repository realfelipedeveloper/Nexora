import type {
  PublicContentEntry,
  PublicNavigationMenu,
  PublicRouteResolution,
  PublicSiteConfiguration,
} from "@nexora/contracts";

type FetchOptions = Parameters<typeof fetch>[1];

export type PublicPageData = {
  configuration: PublicSiteConfiguration | null;
  content: PublicContentEntry | null;
  menu: PublicNavigationMenu | null;
  route: PublicRouteResolution | null;
  status: "available" | "not-found" | "unavailable";
};

export function publicRuntimeConfiguration() {
  return {
    apiUrl: (process.env.CORE_API_INTERNAL_URL ?? "http://localhost:48120").replace(/\/$/u, ""),
    locale: process.env.NEXORA_PUBLIC_LOCALE ?? "pt-BR",
    menuKey: process.env.NEXORA_PUBLIC_MENU_KEY ?? "main",
    siteKey: process.env.NEXORA_PUBLIC_SITE_KEY ?? "nexora-local",
  };
}

async function request<T>(path: string, options?: FetchOptions): Promise<T | null> {
  const { apiUrl } = publicRuntimeConfiguration();
  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: { Accept: "application/json", ...options?.headers },
    next: { revalidate: 60, ...options?.next },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Public API request failed with status ${response.status}.`);
  return (await response.json()) as T;
}

export function publicPath(segments: string[] | undefined) {
  return segments && segments.length > 0 ? `/${segments.join("/")}` : "/";
}

export function publicAssetPath(assetId: string, version: number) {
  return `/api/assets/${encodeURIComponent(assetId)}?v=${version}`;
}

export function contentHeading(content: PublicContentEntry) {
  for (const key of ["title", "headline", "name", "displayName"]) {
    const value = content.data[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return humanizeKey(content.contentType.key);
}

export function contentSummary(content: PublicContentEntry) {
  for (const key of ["summary", "description", "excerpt", "subtitle"]) {
    const value = content.data[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function humanizeKey(key: string) {
  const words = key
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replace(/[-_]+/gu, " ")
    .trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Conteúdo";
}

export function isRichTextDocument(value: unknown): value is Record<string, unknown> {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).type === "doc" &&
    (value as Record<string, unknown>).schemaVersion === 1 &&
    Array.isArray((value as Record<string, unknown>).content),
  );
}

export async function loadPublicPage(path: string): Promise<PublicPageData> {
  const { locale, menuKey, siteKey } = publicRuntimeConfiguration();
  const encodedSite = encodeURIComponent(siteKey);
  const encodedLocale = encodeURIComponent(locale);

  try {
    const [configuration, menu, route] = await Promise.all([
      request<PublicSiteConfiguration>(`/public/sites/${encodedSite}/configuration`),
      request<PublicNavigationMenu>(
        `/public/sites/${encodedSite}/navigation/${encodeURIComponent(menuKey)}?locale=${encodedLocale}`,
      ),
      request<PublicRouteResolution>(
        `/public/sites/${encodedSite}/routes/resolve?locale=${encodedLocale}&path=${encodeURIComponent(path)}`,
      ),
    ]);

    if (!route) {
      return { configuration, content: null, menu, route: null, status: "not-found" };
    }
    if (route.kind === "redirect" || !route.contentEntryId || !route.contentTypeKey) {
      return { configuration, content: null, menu, route, status: "available" };
    }

    const content = await request<PublicContentEntry>(
      `/public/sites/${encodedSite}/content/${encodeURIComponent(route.contentTypeKey)}/${encodeURIComponent(route.contentEntryId)}?locale=${encodedLocale}`,
    );
    return {
      configuration,
      content,
      menu,
      route,
      status: content ? "available" : "not-found",
    };
  } catch {
    return {
      configuration: null,
      content: null,
      menu: null,
      route: null,
      status: "unavailable",
    };
  }
}
