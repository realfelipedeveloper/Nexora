import { BadRequestException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { PublicContentController, publicContentCacheControl } from "./content-public.controller.js";
import {
  InvalidPublicContentQueryError,
  type PublicContentService,
} from "./content-public.service.js";

const entryId = "10000000-0000-4000-8000-000000000001";
const publicEntry = {
  contentType: { key: "article" },
  data: { title: "Public article" },
  id: entryId,
  locale: "pt-BR",
  publishedAt: "2026-09-22T15:00:00.000Z",
  schemaVersion: 1,
  updatedAt: "2026-09-22T15:01:00.000Z",
};

function fixture() {
  const service = { get: vi.fn(), list: vi.fn() };
  const response = { setHeader: vi.fn(), status: vi.fn() };
  return {
    controller: new PublicContentController(service as unknown as PublicContentService),
    response,
    service,
  };
}

describe("PublicContentController", () => {
  it("returns a cacheable page without requiring an administrative session", async () => {
    const { controller, response, service } = fixture();
    service.list.mockResolvedValue({ items: [publicEntry], nextCursor: null });

    await expect(
      controller.list("main-site", "article", "pt-BR", "10", undefined, undefined, response),
    ).resolves.toEqual({ items: [publicEntry], nextCursor: null });
    expect(service.list).toHaveBeenCalledWith("main-site", "article", {
      cursor: undefined,
      limit: "10",
      locale: "pt-BR",
    });
    expect(response.setHeader).toHaveBeenCalledWith(
      "ETag",
      expect.stringMatching(/^"sha256-[A-Za-z0-9_-]+"$/u),
    );
    expect(publicContentCacheControl).toBe(
      "public, max-age=60, s-maxage=300, stale-while-revalidate=60",
    );
  });

  it("returns 304 for a matching strong or weak validator", async () => {
    const { controller, response, service } = fixture();
    service.get.mockResolvedValue(publicEntry);
    await controller.get("main-site", "article", entryId, "pt-BR", undefined, response);
    const etag = response.setHeader.mock.calls[0]?.[1] as string;

    await expect(
      controller.get("main-site", "article", entryId, "pt-BR", `W/${etag}`, response),
    ).resolves.toBeUndefined();
    expect(response.status).toHaveBeenCalledWith(304);
  });

  it("uses the same not-found response for unavailable public content", async () => {
    const { controller, response, service } = fixture();
    service.list.mockResolvedValue(null);
    service.get.mockResolvedValue(null);

    await expect(
      controller.list("main-site", "article", "pt-BR", undefined, undefined, undefined, response),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      controller.get("main-site", "article", entryId, "pt-BR", undefined, response),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("maps malformed public queries to a bounded bad request", async () => {
    const { controller, response, service } = fixture();
    service.list.mockRejectedValue(new InvalidPublicContentQueryError());

    await expect(
      controller.list("main-site", "article", undefined, undefined, undefined, undefined, response),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
