import { describe, expect, it } from "vitest";
import {
  assertPasswordPolicy,
  hashPassword,
  normalizeEmail,
  passwordPolicy,
  verifyPassword,
} from "./credentials.js";

describe("identity credentials", () => {
  it("normalizes email addresses for stable uniqueness", () => {
    expect(normalizeEmail("  Admin@EXAMPLE.COM ")).toBe("admin@example.com");
  });

  it("accepts passwords at the supported length boundaries", () => {
    expect(() => assertPasswordPolicy("a".repeat(passwordPolicy.minimumLength))).not.toThrow();
    expect(() => assertPasswordPolicy("a".repeat(passwordPolicy.maximumLength))).not.toThrow();
  });

  it("rejects passwords outside the supported length boundaries", () => {
    expect(() => assertPasswordPolicy("a".repeat(passwordPolicy.minimumLength - 1))).toThrow(
      /at least 12 characters/u,
    );
    expect(() => assertPasswordPolicy("a".repeat(passwordPolicy.maximumLength + 1))).toThrow(
      /at most 128 characters/u,
    );
  });

  it("counts Unicode code points rather than UTF-16 code units", () => {
    expect(() =>
      assertPasswordPolicy("\u{1F510}".repeat(passwordPolicy.minimumLength)),
    ).not.toThrow();
  });

  it("hashes passwords with Argon2id and a random salt", async () => {
    const password = "correct horse battery staple";
    const firstHash = await hashPassword(password);
    const secondHash = await hashPassword(password);

    expect(firstHash).toMatch(/^\$argon2id\$/u);
    expect(firstHash).not.toContain(password);
    expect(secondHash).not.toBe(firstHash);
    await expect(verifyPassword(firstHash, password)).resolves.toBe(true);
    await expect(verifyPassword(firstHash, "incorrect password")).resolves.toBe(false);
  });

  it("rejects malformed password hashes without leaking parser errors", async () => {
    await expect(verifyPassword("not-a-password-hash", "irrelevant password")).resolves.toBe(false);
  });
});
