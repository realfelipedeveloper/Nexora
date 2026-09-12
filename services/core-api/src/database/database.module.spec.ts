import { describe, expect, it } from "vitest";
import { resolveDatabaseUrl } from "./database.module.js";

describe("database module configuration", () => {
  it("requires an explicit database URL in production", () => {
    expect(() => resolveDatabaseUrl({ NODE_ENV: "production" })).toThrow(/DATABASE_URL/u);
  });

  it("uses the explicit database URL when provided", () => {
    expect(
      resolveDatabaseUrl({ DATABASE_URL: "postgresql://database/nexora", NODE_ENV: "production" }),
    ).toBe("postgresql://database/nexora");
  });

  it("retains the local development default outside production", () => {
    expect(resolveDatabaseUrl({ NODE_ENV: "development" })).toContain("localhost:48130");
  });
});
