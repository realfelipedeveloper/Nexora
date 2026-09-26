import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteMedia, listMedia, uploadMedia } from "./media-api";

afterEach(() => vi.unstubAllGlobals());

describe("CMS media API", () => {
  it("keeps searches scoped to the selected site", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [] })));
    vi.stubGlobal("fetch", fetchMock);
    await listMedia("site-1", "annual report");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/core/sites/site-1/assets?limit=100&q=annual+report",
      { cache: "no-store", credentials: "include" },
    );
  });

  it("uploads multipart data with CSRF and no manual content type", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "asset-1" })));
    vi.stubGlobal("fetch", fetchMock);
    const file = new File(["pdf"], "report.pdf", { type: "application/pdf" });
    await uploadMedia("csrf-token", "site-1", file);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/core/sites/site-1/assets",
      expect.objectContaining({
        body: expect.any(FormData),
        headers: { "x-csrf-token": "csrf-token" },
        method: "POST",
      }),
    );
  });

  it("sends the asset version when deleting", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await deleteMedia("csrf-token", "site-1", "asset-1", 3);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/core/sites/site-1/assets/asset-1",
      expect.objectContaining({
        headers: { "If-Match": '"3"', "x-csrf-token": "csrf-token" },
        method: "DELETE",
      }),
    );
  });
});
