import { Injectable } from "@nestjs/common";
import {
  globalConfigurationSchemas,
  siteConfigurationSchemas,
  type GlobalConfigurationKey,
  type GlobalConfigurationValues,
  type SiteConfigurationKey,
  type SiteConfigurationValues,
} from "@nexora/schemas";

export type ConfigurationScope = "global" | "site";

export type ConfigurationIssue = {
  code: string;
  message: string;
  path: string;
};

export const maximumConfigurationBytes = 16_384;

export class ConfigurationKeyNotRegisteredError extends Error {
  override readonly name = "ConfigurationKeyNotRegisteredError";

  constructor(readonly scope: ConfigurationScope) {
    super("Configuration key is not registered for this scope.");
  }
}

export class ConfigurationValueInvalidError extends Error {
  override readonly name = "ConfigurationValueInvalidError";

  constructor(readonly issues: readonly ConfigurationIssue[]) {
    super("Configuration value is invalid.");
  }
}

export class ConfigurationValueTooLargeError extends Error {
  override readonly name = "ConfigurationValueTooLargeError";

  constructor(readonly maximumBytes = maximumConfigurationBytes) {
    super("Configuration value exceeds the supported size.");
  }
}

type ConfigurationSchema = {
  safeParse: (value: unknown) =>
    | { data: unknown; success: true }
    | {
        error: {
          issues: readonly { code: string; message: string; path: readonly PropertyKey[] }[];
        };
        success: false;
      };
};

const registries: Record<ConfigurationScope, Readonly<Record<string, ConfigurationSchema>>> = {
  global: globalConfigurationSchemas,
  site: siteConfigurationSchemas,
};

const publicProjectionKeys: Record<ConfigurationScope, readonly string[]> = {
  global: Object.freeze(["platform.branding"]),
  site: Object.freeze(["site.identity"]),
};

function sanitizedPath(path: readonly PropertyKey[]) {
  return path
    .map((segment) => String(segment))
    .filter((segment) => /^[A-Za-z0-9_-]{1,64}$/u.test(segment))
    .join(".");
}

function encodedSize(value: unknown) {
  try {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) {
      throw new TypeError("Value is not JSON serializable.");
    }
    return Buffer.byteLength(encoded, "utf8");
  } catch {
    throw new ConfigurationValueInvalidError([
      { code: "invalid_json", message: "Value must be JSON serializable.", path: "" },
    ]);
  }
}

@Injectable()
export class ConfigurationRegistry {
  registeredKeys(scope: ConfigurationScope) {
    return Object.freeze(Object.keys(registries[scope]));
  }

  publicKeys(scope: ConfigurationScope) {
    return publicProjectionKeys[scope];
  }

  validateGlobal<Key extends GlobalConfigurationKey>(
    key: Key,
    value: unknown,
  ): GlobalConfigurationValues[Key] {
    return this.validateUnknown("global", key, value) as GlobalConfigurationValues[Key];
  }

  validateSite<Key extends SiteConfigurationKey>(
    key: Key,
    value: unknown,
  ): SiteConfigurationValues[Key] {
    return this.validateUnknown("site", key, value) as SiteConfigurationValues[Key];
  }

  validateUnknown(scope: ConfigurationScope, key: string, value: unknown): unknown {
    const schema = registries[scope][key];
    if (!schema) {
      throw new ConfigurationKeyNotRegisteredError(scope);
    }

    if (encodedSize(value) > maximumConfigurationBytes) {
      throw new ConfigurationValueTooLargeError();
    }

    const result = schema.safeParse(value);
    if (!result.success) {
      throw new ConfigurationValueInvalidError(
        result.error.issues.map((issue) => ({
          code: issue.code,
          message: "Value does not match the registered schema.",
          path: sanitizedPath(issue.path),
        })),
      );
    }

    return result.data;
  }
}
