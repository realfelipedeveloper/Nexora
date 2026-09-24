import { BadRequestException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { ContentVersioningController } from "./content-versioning.controller.js";
import {
  ContentEntryRevisionNotFoundError,
  type ContentVersioningService,
  InvalidContentRevisionComparisonError,
} from "./content-versioning.service.js";

function fixture() {
  const service = { compareRevisions: vi.fn() };
  return {
    controller: new ContentVersioningController(service as unknown as ContentVersioningService),
    service,
  };
}

describe("content versioning controller", () => {
  it("delegates a site-scoped revision comparison", async () => {
    const { controller, service } = fixture();
    const comparison = { contentEntryId: "entry-1", fieldChanges: [] };
    service.compareRevisions.mockResolvedValue(comparison);

    await expect(controller.compare("site-1", "entry-1", "1", "3")).resolves.toBe(comparison);
    expect(service.compareRevisions).toHaveBeenCalledWith("site-1", "entry-1", {
      from: "1",
      to: "3",
    });
  });

  it.each([
    [new InvalidContentRevisionComparisonError(), BadRequestException],
    [new ContentEntryRevisionNotFoundError(), NotFoundException],
  ])("maps bounded versioning errors to HTTP responses", async (failure, expected) => {
    const { controller, service } = fixture();
    service.compareRevisions.mockRejectedValue(failure);

    await expect(controller.compare("site-1", "entry-1", "1", "2")).rejects.toBeInstanceOf(
      expected,
    );
  });

  it("preserves unexpected service failures", async () => {
    const { controller, service } = fixture();
    const failure = new Error("unexpected persistence failure");
    service.compareRevisions.mockRejectedValue(failure);

    await expect(controller.compare("site-1", "entry-1", "1", "2")).rejects.toBe(failure);
  });
});
