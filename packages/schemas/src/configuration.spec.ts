import { describe, expect, it } from "vitest";
import {
  featureFlagDefaults,
  globalConfigurationSchemas,
  localeCreateSchema,
  localeUpdateSchema,
  siteConfigurationSchemas,
  siteCreateSchema,
  siteStatusUpdateSchema,
} from "./index.js";

describe("configuration schemas", () => {
  it("normalizes registered global branding values", () => {
    expect(
      globalConfigurationSchemas["platform.branding"].parse({ productName: "  Nexora  " }),
    ).toEqual({ productName: "Nexora" });
  });

  it("accepts a bounded site identity", () => {
    expect(
      siteConfigurationSchemas["site.identity"].parse({
        description: "  Universal content platform  ",
        displayName: "  Nexora Docs  ",
      }),
    ).toEqual({
      description: "Universal content platform",
      displayName: "Nexora Docs",
    });
  });

  it("accepts only registered feature flags and keeps safe defaults disabled", () => {
    expect(
      globalConfigurationSchemas["platform.features"].parse({ "public.search": true }),
    ).toEqual({
      "public.search": true,
    });
    expect(siteConfigurationSchemas["site.features"].safeParse({ unknown: true }).success).toBe(
      false,
    );
    expect(Object.values(featureFlagDefaults).every((enabled) => !enabled)).toBe(true);
  });

  it("normalizes locale commands and requires a meaningful update", () => {
    expect(localeCreateSchema.parse({ code: " pt-br " })).toEqual({ code: "pt-BR" });
    expect(localeUpdateSchema.safeParse({}).success).toBe(false);
    expect(localeUpdateSchema.parse({ fallbackLocaleId: null, isDefault: true })).toEqual({
      fallbackLocaleId: null,
      isDefault: true,
    });
  });

  it("rejects unknown, empty and oversized properties", () => {
    const identity = siteConfigurationSchemas["site.identity"];

    expect(identity.safeParse({ displayName: "" }).success).toBe(false);
    expect(identity.safeParse({ displayName: "a".repeat(121) }).success).toBe(false);
    expect(identity.safeParse({ displayName: "Nexora", password: "do-not-store" }).success).toBe(
      false,
    );
  });

  it("normalizes valid site lifecycle commands", () => {
    expect(siteCreateSchema.parse({ key: "main-site", name: "  Main Site  " })).toEqual({
      key: "main-site",
      name: "Main Site",
    });
    expect(siteStatusUpdateSchema.parse({ status: "ARCHIVED" })).toEqual({
      status: "ARCHIVED",
    });
  });

  it.each([
    { key: "Main-Site", name: "Main Site" },
    { key: "main_site", name: "Main Site" },
    { key: "main-site", name: "" },
    { key: "main-site", name: "a".repeat(121) },
    { key: "main-site", name: "Main Site", token: "not-configuration" },
  ])("rejects invalid site creation input", (input) => {
    expect(siteCreateSchema.safeParse(input).success).toBe(false);
  });

  it("rejects unsupported lifecycle states and extra properties", () => {
    expect(siteStatusUpdateSchema.safeParse({ status: "DELETED" }).success).toBe(false);
    expect(siteStatusUpdateSchema.safeParse({ reason: "secret", status: "ACTIVE" }).success).toBe(
      false,
    );
  });
});
