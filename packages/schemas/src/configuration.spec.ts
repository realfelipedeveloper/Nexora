import { describe, expect, it } from "vitest";
import {
  globalConfigurationSchemas,
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
