import { describe, expect, it } from "vitest";
import { hashSessionToken, issueSessionToken } from "./session-token.js";

describe("identity session tokens", () => {
  it("issues independent 256-bit opaque tokens with storage-safe hashes", () => {
    const first = issueSessionToken();
    const second = issueSessionToken();

    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(first.tokenHash).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(first.tokenHash).toBe(hashSessionToken(first.token));
    expect(first.tokenHash).not.toBe(first.token);
    expect(second.token).not.toBe(first.token);
    expect(second.tokenHash).not.toBe(first.tokenHash);
  });

  it("rejects empty tokens", () => {
    expect(() => hashSessionToken("")).toThrow(/cannot be empty/u);
  });
});
