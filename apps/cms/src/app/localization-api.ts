export type SiteLocale = {
  code: string;
  fallbackLocale: { code: string; id: string } | null;
  fallbackLocaleId: string | null;
  id: string;
  isDefault: boolean;
  version: number;
};

export class LocalizationApiError extends Error {
  override readonly name = "LocalizationApiError";
  constructor(readonly status: number) {
    super(`Localization request failed with status ${status}.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseLocale(value: unknown): SiteLocale {
  if (
    !isRecord(value) ||
    typeof value.code !== "string" ||
    typeof value.id !== "string" ||
    typeof value.isDefault !== "boolean" ||
    !Number.isSafeInteger(value.version) ||
    (value.fallbackLocaleId !== null && typeof value.fallbackLocaleId !== "string") ||
    (value.fallbackLocale !== null &&
      (!isRecord(value.fallbackLocale) ||
        typeof value.fallbackLocale.code !== "string" ||
        typeof value.fallbackLocale.id !== "string"))
  ) {
    throw new TypeError("Invalid locale response.");
  }
  return value as SiteLocale;
}

async function request(path: string, init: RequestInit = {}) {
  const response = await fetch(`/api/core${path}`, {
    ...init,
    cache: "no-store",
    credentials: "include",
  });
  if (!response.ok) throw new LocalizationApiError(response.status);
  return response;
}

function assertVersion(response: Response, locale: SiteLocale) {
  if (response.headers.get("etag") !== `"${locale.version}"`) {
    throw new TypeError("Invalid locale version response.");
  }
}

export async function listLocales(siteId: string) {
  const response = await request(`/sites/${siteId}/locales`);
  const value: unknown = await response.json();
  if (!Array.isArray(value)) throw new TypeError("Invalid locales response.");
  return value.map(parseLocale);
}

export async function createLocale(
  csrfToken: string,
  siteId: string,
  input: { code: string; fallbackLocaleId?: string | null; isDefault?: boolean },
) {
  const response = await request(`/sites/${siteId}/locales`, {
    body: JSON.stringify(input),
    headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
    method: "POST",
  });
  const locale = parseLocale(await response.json());
  assertVersion(response, locale);
  return locale;
}

export async function updateLocale(
  csrfToken: string,
  siteId: string,
  locale: SiteLocale,
  input: { fallbackLocaleId?: string | null; isDefault?: boolean },
) {
  const response = await request(`/sites/${siteId}/locales/${locale.id}`, {
    body: JSON.stringify(input),
    headers: {
      "Content-Type": "application/json",
      "If-Match": `"${locale.version}"`,
      "x-csrf-token": csrfToken,
    },
    method: "PATCH",
  });
  const updated = parseLocale(await response.json());
  assertVersion(response, updated);
  return updated;
}

export function deleteLocale(csrfToken: string, siteId: string, locale: SiteLocale) {
  return request(`/sites/${siteId}/locales/${locale.id}`, {
    headers: { "If-Match": `"${locale.version}"`, "x-csrf-token": csrfToken },
    method: "DELETE",
  }).then(() => undefined);
}
