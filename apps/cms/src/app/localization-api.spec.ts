import { afterEach, describe, expect, it, vi } from "vitest";
import { listLocales, updateLocale } from "./localization-api";

function locale(version = 1) {
  return {
    code: "pt-BR",
    fallbackLocale: null,
    fallbackLocaleId: null,
    id: "20000000-0000-4000-8000-000000000001",
    isDefault: true,
    version,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("CMS localization API", () => {
  it("parses the site locale collection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json([locale()])));
    await expect(listLocales("site-1")).resolves.toEqual([locale()]);
  });

  it("sends CSRF and the current locale version on updates", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json(locale(2), { headers: { ETag: '"2"' } }));
    vi.stubGlobal("fetch", fetchMock);

    await updateLocale("csrf", "site-1", locale(), { fallbackLocaleId: null });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/core/sites/site-1/locales/20000000-0000-4000-8000-000000000001",
      {
        body: JSON.stringify({ fallbackLocaleId: null }),
        cache: "no-store",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "If-Match": '"1"',
          "x-csrf-token": "csrf",
        },
        method: "PATCH",
      },
    );
  });

  it("rejects an invalid locale response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json([{ code: "pt-BR" }])));
    await expect(listLocales("site-1")).rejects.toThrow("Invalid locale response.");
  });
});
