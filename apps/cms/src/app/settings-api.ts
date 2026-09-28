import type { FeatureFlagKey } from "@nexora/schemas";

export const cmsFeatureFlagKeys = [
  "engagement.comments",
  "engagement.newsletter",
  "public.search",
] as const satisfies readonly FeatureFlagKey[];

export type CmsSite = {
  id: string;
  key: string;
  name: string;
  status: "ACTIVE" | "ARCHIVED";
};

export type StoredSetting<Value> = {
  key: string;
  value: Value;
  version: number;
};

export type PlatformBranding = {
  productName: string;
};

export type SiteIdentity = {
  description?: string;
  displayName: string;
};

export type FeatureFlags = Partial<Record<FeatureFlagKey, boolean>>;
export type ResolvedFeatureFlags = {
  flags: Record<FeatureFlagKey, boolean>;
  global: FeatureFlags;
  site: FeatureFlags;
};

export class CmsApiError extends Error {
  override readonly name = "CmsApiError";

  constructor(readonly status: number) {
    super(`CMS request failed with status ${status}.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function parseSite(value: unknown): CmsSite {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.key !== "string" ||
    typeof value.name !== "string" ||
    (value.status !== "ACTIVE" && value.status !== "ARCHIVED")
  ) {
    throw new TypeError("Invalid site response.");
  }

  return { id: value.id, key: value.key, name: value.name, status: value.status };
}

function parseBranding(value: unknown): PlatformBranding {
  if (!isRecord(value) || typeof value.productName !== "string") {
    throw new TypeError("Invalid platform branding response.");
  }
  return { productName: value.productName };
}

function parseIdentity(value: unknown): SiteIdentity {
  if (
    !isRecord(value) ||
    typeof value.displayName !== "string" ||
    (value.description !== undefined && typeof value.description !== "string")
  ) {
    throw new TypeError("Invalid site identity response.");
  }

  return value.description === undefined
    ? { displayName: value.displayName }
    : { description: value.description, displayName: value.displayName };
}

function parseFeatureFlags(value: unknown): FeatureFlags {
  if (!isRecord(value)) throw new TypeError("Invalid feature flags response.");
  const allowed = new Set<string>(cmsFeatureFlagKeys);
  if (
    Object.entries(value).some(
      ([key, enabled]) => !allowed.has(key) || typeof enabled !== "boolean",
    )
  ) {
    throw new TypeError("Invalid feature flags response.");
  }
  return value;
}

function parseResolvedFeatureFlags(value: unknown): ResolvedFeatureFlags {
  if (!isRecord(value)) throw new TypeError("Invalid resolved feature flags response.");
  const flags = parseFeatureFlags(value.flags);
  if (cmsFeatureFlagKeys.some((key) => typeof flags[key] !== "boolean")) {
    throw new TypeError("Invalid resolved feature flags response.");
  }
  return {
    flags: flags as Record<FeatureFlagKey, boolean>,
    global: parseFeatureFlags(value.global),
    site: parseFeatureFlags(value.site),
  };
}

function parseSetting<Value>(
  value: unknown,
  key: string,
  parseValue: (candidate: unknown) => Value,
): StoredSetting<Value> {
  if (!isRecord(value) || value.key !== key || !isVersion(value.version)) {
    throw new TypeError("Invalid configuration response.");
  }
  return { key, value: parseValue(value.value), version: value.version };
}

async function request(path: string, init: RequestInit = {}) {
  const response = await fetch(`/api/core${path}`, {
    ...init,
    cache: "no-store",
    credentials: "include",
  });

  if (!response.ok) {
    throw new CmsApiError(response.status);
  }
  return response;
}

function assertEtag(response: Response, version: number) {
  if (response.headers.get("etag") !== `"${version}"`) {
    throw new TypeError("Invalid configuration version response.");
  }
}

async function readSetting<Value>(
  path: string,
  key: string,
  parseValue: (candidate: unknown) => Value,
): Promise<StoredSetting<Value> | null> {
  try {
    const response = await request(path);
    const setting = parseSetting(await response.json(), key, parseValue);
    assertEtag(response, setting.version);
    return setting;
  } catch (error) {
    if (error instanceof CmsApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

async function writeSetting<Value>(
  path: string,
  csrfToken: string,
  key: string,
  value: Value,
  current: StoredSetting<Value> | null,
  parseValue: (candidate: unknown) => Value,
) {
  const response = await request(path, {
    body: JSON.stringify(value),
    headers: {
      "Content-Type": "application/json",
      ...(current ? { "If-Match": `"${current.version}"` } : { "If-None-Match": "*" }),
      "x-csrf-token": csrfToken,
    },
    method: "PUT",
  });
  const setting = parseSetting(await response.json(), key, parseValue);
  assertEtag(response, setting.version);
  return setting;
}

export async function listSites() {
  const response = await request("/sites");
  const value: unknown = await response.json();
  if (!Array.isArray(value)) {
    throw new TypeError("Invalid sites response.");
  }
  return value.map(parseSite);
}

export function readPlatformBranding() {
  return readSetting("/settings/global/platform.branding", "platform.branding", parseBranding);
}

export function savePlatformBranding(
  csrfToken: string,
  value: PlatformBranding,
  current: StoredSetting<PlatformBranding> | null,
) {
  return writeSetting(
    "/settings/global/platform.branding",
    csrfToken,
    "platform.branding",
    value,
    current,
    parseBranding,
  );
}

export function readPlatformFeatures() {
  return readSetting("/settings/global/platform.features", "platform.features", parseFeatureFlags);
}

export function savePlatformFeatures(
  csrfToken: string,
  value: FeatureFlags,
  current: StoredSetting<FeatureFlags> | null,
) {
  return writeSetting(
    "/settings/global/platform.features",
    csrfToken,
    "platform.features",
    value,
    current,
    parseFeatureFlags,
  );
}

export function readSiteIdentity(siteId: string) {
  return readSetting(`/sites/${siteId}/settings/site.identity`, "site.identity", parseIdentity);
}

export function saveSiteIdentity(
  csrfToken: string,
  siteId: string,
  value: SiteIdentity,
  current: StoredSetting<SiteIdentity> | null,
) {
  return writeSetting(
    `/sites/${siteId}/settings/site.identity`,
    csrfToken,
    "site.identity",
    value,
    current,
    parseIdentity,
  );
}

export function readSiteFeatures(siteId: string) {
  return readSetting(`/sites/${siteId}/settings/site.features`, "site.features", parseFeatureFlags);
}

export function readResolvedSiteFeatures(siteId: string) {
  return request(`/sites/${siteId}/settings/features/resolved`)
    .then((response) => response.json())
    .then(parseResolvedFeatureFlags);
}

export function saveSiteFeatures(
  csrfToken: string,
  siteId: string,
  value: FeatureFlags,
  current: StoredSetting<FeatureFlags> | null,
) {
  return writeSetting(
    `/sites/${siteId}/settings/site.features`,
    csrfToken,
    "site.features",
    value,
    current,
    parseFeatureFlags,
  );
}
