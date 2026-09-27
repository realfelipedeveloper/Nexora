export const foundationStatus = {
  status: "ready-for-localhost",
  core: "domain-agnostic",
} as const;

export type HealthResponse = {
  service: string;
  status: "ok" | "ready";
  timestamp?: string;
};

export type PublicSiteConfiguration = {
  branding?: {
    productName: string;
  };
  site: {
    identity?: {
      description?: string;
      displayName: string;
    };
    key: string;
  };
};

export type PublicContentEntry = {
  assets: PublicContentAsset[];
  contentType: {
    key: string;
  };
  data: Record<string, unknown>;
  id: string;
  locale: string;
  publishedAt: string;
  schemaVersion: number;
  updatedAt: string;
};

export type PublicContentAsset = {
  altText: string | null;
  displayName: string;
  id: string;
  mimeType: string;
  position: number;
  role: string;
  version: number;
};

export type PublicContentPage = {
  items: PublicContentEntry[];
  nextCursor: string | null;
};

export type PublicRouteResolution =
  | {
      contentEntryId: string | null;
      contentTypeKey: string | null;
      kind: "route";
      path: string;
      routeId: string;
    }
  | {
      kind: "redirect";
      location: string;
      statusCode: 301 | 302 | 307 | 308;
    };

export type PublicNavigationItem = {
  children: PublicNavigationItem[];
  externalUrl: string | null;
  id: string;
  label: string;
  linkType: "EXTERNAL" | "INTERNAL";
  parentId: string | null;
  path: string | null;
  position: number;
};

export type PublicNavigationMenu = {
  items: PublicNavigationItem[];
  key: string;
  locale: string;
  name: string;
};

export type ContentPreview = {
  contentType: {
    displayName: string;
    key: string;
  };
  data: Record<string, unknown>;
  expiresAt: string;
  id: string;
  locale: string;
  revision: number;
  schemaVersion: number;
  scheduledPublication: {
    action: "PUBLISH" | "UNPUBLISH";
    scheduledFor: string;
  } | null;
  site: {
    key: string;
    name: string;
  };
  snapshotAt: string;
  status: "ARCHIVED" | "DRAFT" | "IN_REVIEW" | "PUBLISHED";
};
