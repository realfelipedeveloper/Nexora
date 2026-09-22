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

export type PublicContentPage = {
  items: PublicContentEntry[];
  nextCursor: string | null;
};
