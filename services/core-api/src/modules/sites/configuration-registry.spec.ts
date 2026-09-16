import { describe, expect, it } from "vitest";
import {
  ConfigurationKeyNotRegisteredError,
  ConfigurationRegistry,
  ConfigurationValueInvalidError,
  ConfigurationValueTooLargeError,
  maximumConfigurationBytes,
} from "./configuration-registry.js";

describe("ConfigurationRegistry", () => {
  const registry = new ConfigurationRegistry();

  it("validates and normalizes typed global and site values", () => {
    const branding = registry.validateGlobal("platform.branding", {
      productName: "  Nexora  ",
    });
    const identity = registry.validateSite("site.identity", {
      displayName: "  Main Site  ",
    });

    expect(branding.productName).toBe("Nexora");
    expect(identity.displayName).toBe("Main Site");
    expect(registry.registeredKeys("global")).toEqual(["platform.branding"]);
    expect(registry.registeredKeys("site")).toEqual(["site.identity"]);
    expect(registry.publicKeys("global")).toEqual(["platform.branding"]);
    expect(registry.publicKeys("site")).toEqual(["site.identity"]);
  });

  it("rejects keys outside their registered scope", () => {
    const submittedSecret = "token-shaped-unknown-key";
    let capturedError: unknown;
    try {
      registry.validateUnknown("global", submittedSecret, {});
    } catch (error) {
      capturedError = error;
    }

    expect(capturedError).toBeInstanceOf(ConfigurationKeyNotRegisteredError);
    expect(JSON.stringify(capturedError)).not.toContain(submittedSecret);
    expect(() => registry.validateUnknown("site", "platform.branding", {})).toThrow(
      ConfigurationKeyNotRegisteredError,
    );
  });

  it("returns sanitized validation issues without retaining submitted values", () => {
    const submittedSecret = "never-retain-this-value";
    const submittedProperty = "private-token-property";

    expect.assertions(5);
    try {
      registry.validateUnknown("site", "site.identity", {
        displayName: "Main Site",
        [submittedProperty]: submittedSecret,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationValueInvalidError);
      expect(error).toMatchObject({
        issues: [expect.objectContaining({ code: "unrecognized_keys" })],
      });
      expect(JSON.stringify(error)).not.toContain(submittedSecret);
      expect(JSON.stringify(error)).not.toContain(submittedProperty);
      expect(String(error)).not.toContain(submittedSecret);
    }
  });

  it("rejects oversized and non-serializable values before parsing", () => {
    expect(() =>
      registry.validateUnknown("site", "site.identity", {
        displayName: "a".repeat(maximumConfigurationBytes),
      }),
    ).toThrow(ConfigurationValueTooLargeError);

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => registry.validateUnknown("site", "site.identity", circular)).toThrow(
      ConfigurationValueInvalidError,
    );
  });
});
