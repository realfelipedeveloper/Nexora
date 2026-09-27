import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const assetId = "10000000-0000-4000-8000-000000000001";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("public asset proxy", () => {
  it("rejects malformed identifiers and versions before reaching the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new NextRequest("http://localhost/api/assets/bad?v=0"), {
      params: Promise.resolve({ assetId: "bad" }),
    });

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("streams an immutable published asset through the site origin", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("image", {
        headers: {
          "Cache-Control": "public, max-age=31536000, immutable",
          "Content-Type": "image/jpeg",
          ETag: '"sha256-public"',
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new NextRequest(`http://localhost/api/assets/${assetId}?v=4`), {
      params: Promise.resolve({ assetId }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:48120/public/sites/nexora-local/assets/${assetId}/content?v=4`,
      expect.objectContaining({ headers: { Accept: "*/*" } }),
    );
  });
});
