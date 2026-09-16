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
