import { afterEach, describe, expect, it, vi } from "vitest";
import { identityConfiguration } from "./identity.config.js";

describe("identity configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses an eight-hour development session by default", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AUTH_SESSION_TTL_MINUTES", undefined);

    expect(identityConfiguration()).toEqual({
      secureCookies: false,
      sessionTtlMs: 8 * 60 * 60 * 1_000,
    });
  });

  it("enables secure cookies in production and accepts a bounded TTL", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SESSION_TTL_MINUTES", "60");

    expect(identityConfiguration()).toEqual({
      secureCookies: true,
      sessionTtlMs: 60 * 60 * 1_000,
    });
  });

  it.each(["0", "4", "1441", "1.5", "invalid"])("rejects an unsafe TTL of %s", (value) => {
    vi.stubEnv("AUTH_SESSION_TTL_MINUTES", value);

    expect(() => identityConfiguration()).toThrow(/AUTH_SESSION_TTL_MINUTES/u);
  });
});
