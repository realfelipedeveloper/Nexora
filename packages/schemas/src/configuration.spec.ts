import { describe, expect, it } from "vitest";
import { globalConfigurationSchemas, siteConfigurationSchemas } from "./index.js";

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
});
