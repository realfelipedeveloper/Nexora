import type { PublicContentEntry } from "@nexora/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  contentHeading,
  contentSummary,
  humanizeKey,
  isRichTextDocument,
  loadPublicPage,
  publicAssetPath,
  publicPath,
} from "./public-site";

const content: PublicContentEntry = {
  assets: [],
  contentType: { key: "news-article" },
  data: { description: "Public summary", title: "Published title" },
  id: "10000000-0000-4000-8000-000000000001",
  locale: "pt-BR",
  publishedAt: "2026-09-27T12:00:00.000Z",
  schemaVersion: 1,
  updatedAt: "2026-09-27T12:00:00.000Z",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("public site integration", () => {
  it("builds safe public paths and presentation fallbacks", () => {
    expect(publicPath(undefined)).toBe("/");
    expect(publicPath(["noticias", "lancamento"])).toBe("/noticias/lancamento");
    expect(publicAssetPath("asset id", 3)).toBe("/api/assets/asset%20id?v=3");
    expect(contentHeading(content)).toBe("Published title");
    expect(contentSummary(content)).toBe("Public summary");
    expect(humanizeKey("newsArticle")).toBe("News Article");
    expect(isRichTextDocument({ content: [], schemaVersion: 1, type: "doc" })).toBe(true);
    expect(isRichTextDocument({ content: [], type: "doc" })).toBe(false);
  });

  it("resolves configuration, menu, route and its published projection", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/configuration")) {
        return Response.json({ site: { identity: { displayName: "Nexora" }, key: "main" } });
      }
      if (url.includes("/navigation/")) {
        return Response.json({ items: [], key: "main", locale: "pt-BR", name: "Principal" });
      }
      if (url.includes("/routes/resolve")) {
        return Response.json({
          contentEntryId: content.id,
          contentTypeKey: "news-article",
          kind: "route",
          path: "/noticias",
          routeId: "20000000-0000-4000-8000-000000000001",
        });
      }
      return Response.json(content);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadPublicPage("/noticias")).resolves.toMatchObject({
      content,
      status: "available",
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls.map(([url]) => String(url)).join("\n")).toContain(
      "/content/news-article/10000000-0000-4000-8000-000000000001?locale=pt-BR",
    );
  });

  it("never falls back to drafts when the public route is absent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) =>
        String(input).includes("/routes/resolve")
          ? new Response(null, { status: 404 })
          : new Response(null, { status: 404 }),
      ),
    );

    await expect(loadPublicPage("/draft")).resolves.toEqual({
      configuration: null,
      content: null,
      menu: null,
      route: null,
      status: "not-found",
    });
  });

  it("returns an unavailable state without leaking upstream errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("private infrastructure details")));

    await expect(loadPublicPage("/")).resolves.toEqual({
      configuration: null,
      content: null,
      menu: null,
      route: null,
      status: "unavailable",
    });
  });
});
