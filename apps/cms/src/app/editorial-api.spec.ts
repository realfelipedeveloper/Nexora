import { afterEach, describe, expect, it, vi } from "vitest";
import {
  changeEntryStatus,
  getContentType,
  issueContentPreview,
  listContentEntries,
  saveContentEntry,
} from "./editorial-api";
import type { EditorialApiError } from "./editorial-api";

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), { headers, status });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CMS editorial API", () => {
  it("keeps entry filters scoped to the selected site", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await listContentEntries("site-1", "type-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/core/sites/site-1/content-entries?limit=100&contentTypeId=type-1",
      { cache: "no-store", credentials: "include" },
    );
  });

  it("requires a valid ETag on versioned reads", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ id: "type-1" })));

    await expect(getContentType("site-1", "type-1")).rejects.toThrow(
      "did not include a valid version",
    );
  });

  it("sends CSRF and the current revision when saving an entry", async () => {
    const entry = { id: "entry-1", revision: 4 };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(entry, 200, { ETag: '"4"' }));
    vi.stubGlobal("fetch", fetchMock);

    await saveContentEntry(
      "csrf-token",
      "site-1",
      { locales: [{ data: { title: "Updated" }, localeId: "locale-1" }] },
      { id: "entry-1", revision: 3 },
    );

    expect(fetchMock).toHaveBeenCalledWith("/api/core/sites/site-1/content-entries/entry-1", {
      body: JSON.stringify({ locales: [{ data: { title: "Updated" }, localeId: "locale-1" }] }),
      cache: "no-store",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "If-Match": '"3"',
        "x-csrf-token": "csrf-token",
      },
      method: "PUT",
    });
  });

  it("preserves bounded API failures for conflict handling", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ message: "Approval required." }, 409)),
    );

    await expect(
      changeEntryStatus("csrf-token", "site-1", "entry-1", 3, "PUBLISHED"),
    ).rejects.toEqual(
      expect.objectContaining<Partial<EditorialApiError>>({
        message: "Approval required.",
        status: 409,
      }),
    );
  });

  it("issues revision-scoped previews with CSRF protection", async () => {
    const preview = {
      expiresAt: "2026-09-26T22:05:00.000Z",
      id: "preview-1",
      localeId: "locale-1",
      revision: 4,
      token: "A".repeat(32),
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(preview));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      issueContentPreview("csrf-token", "site-1", "entry-1", "locale-1", 4),
    ).resolves.toEqual(preview);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/core/sites/site-1/content-entries/entry-1/preview-tokens",
      {
        body: JSON.stringify({ localeId: "locale-1", revision: 4 }),
        cache: "no-store",
        credentials: "include",
        headers: { "Content-Type": "application/json", "x-csrf-token": "csrf-token" },
        method: "POST",
      },
    );
  });
});
