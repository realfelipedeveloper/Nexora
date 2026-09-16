import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CmsApiError,
  listSites,
  readPlatformBranding,
  savePlatformBranding,
  saveSiteIdentity,
} from "./settings-api";

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), { headers, status });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CMS settings API", () => {
  it("lists only sites returned for the current session", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse([{ id: "site-1", key: "docs", name: "Documentation", status: "ACTIVE" }]),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(listSites()).resolves.toEqual([
      { id: "site-1", key: "docs", name: "Documentation", status: "ACTIVE" },
    ]);
    expect(fetchMock).toHaveBeenCalledWith("/api/core/sites", {
      cache: "no-store",
      credentials: "include",
    });
  });

  it("returns null when a configuration has not been created", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));

    await expect(readPlatformBranding()).resolves.toBeNull();
  });

  it("requires the ETag to agree with a configuration version", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          { key: "platform.branding", value: { productName: "Nexora" }, version: 2 },
          200,
          {
            ETag: '"1"',
          },
        ),
      ),
    );

    await expect(readPlatformBranding()).rejects.toThrow("Invalid configuration version response.");
  });

  it("uses CSRF and an ETag version when updating configuration", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { key: "platform.branding", value: { productName: "Nexora One" }, version: 3 },
          200,
          { ETag: '"3"' },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      savePlatformBranding(
        "a".repeat(43),
        { productName: "Nexora One" },
        { key: "platform.branding", value: { productName: "Nexora" }, version: 2 },
      ),
    ).resolves.toMatchObject({ version: 3 });
    expect(fetchMock).toHaveBeenCalledWith("/api/core/settings/global/platform.branding", {
      body: JSON.stringify({ productName: "Nexora One" }),
      cache: "no-store",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "If-Match": '"2"',
        "x-csrf-token": "a".repeat(43),
      },
      method: "PUT",
    });
  });

  it("uses create preconditions for a new site identity", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { key: "site.identity", value: { displayName: "Documentation" }, version: 1 },
          200,
          { ETag: '"1"' },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await saveSiteIdentity("a".repeat(43), "site-1", { displayName: "Documentation" }, null);
    expect(fetchMock).toHaveBeenCalledWith("/api/core/sites/site-1/settings/site.identity", {
      body: JSON.stringify({ displayName: "Documentation" }),
      cache: "no-store",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "If-None-Match": "*",
        "x-csrf-token": "a".repeat(43),
      },
      method: "PUT",
    });
  });

  it("preserves API status failures for the interface", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 412 })));

    await expect(
      savePlatformBranding("a".repeat(43), { productName: "Nexora" }, null),
    ).rejects.toBeInstanceOf(CmsApiError);
  });
});
