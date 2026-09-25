import {
  BadRequestException,
  HttpException,
  NotFoundException,
  PreconditionFailedException,
} from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedRequest } from "../identity/session-authentication.guard.js";
import {
  ContentEntryNotFoundError,
  ContentPreconditionFailedError,
} from "./content-admin.service.js";
import { ContentVersioningController } from "./content-versioning.controller.js";
import {
  ContentEntryRevisionNotFoundError,
  type ContentVersioningService,
  InvalidContentRevisionComparisonError,
  InvalidContentRevisionError,
} from "./content-versioning.service.js";

function fixture() {
  const service = { compareRevisions: vi.fn(), listRevisions: vi.fn(), restoreRevision: vi.fn() };
  return {
    controller: new ContentVersioningController(service as unknown as ContentVersioningService),
    service,
  };
}

describe("content versioning controller", () => {
  it("lists site-scoped revision metadata", async () => {
    const { controller, service } = fixture();
    const revisions = [{ revision: 2 }, { revision: 1 }];
    service.listRevisions.mockResolvedValue(revisions);

    await expect(controller.list("site-1", "entry-1")).resolves.toBe(revisions);
    expect(service.listRevisions).toHaveBeenCalledWith("site-1", "entry-1");
  });

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

  it("restores a site-scoped revision and exposes its new entity tag", async () => {
    const { controller, service } = fixture();
    const request = { identity: { user: { id: "actor-1" } } } as AuthenticatedRequest;
    const response = { setHeader: vi.fn() };
    const restored = { id: "entry-1", revision: 8, status: "DRAFT" };
    service.restoreRevision.mockResolvedValue(restored);

    await expect(
      controller.restore(request, "site-1", "entry-1", "3", '"7"', response),
    ).resolves.toBe(restored);
    expect(service.restoreRevision).toHaveBeenCalledWith("actor-1", "site-1", "entry-1", "3", 7);
    expect(response.setHeader).toHaveBeenCalledWith("ETag", '"8"');
  });

  it.each([
    [new InvalidContentRevisionError(), BadRequestException],
    [new ContentEntryRevisionNotFoundError(), NotFoundException],
    [new ContentEntryNotFoundError(), NotFoundException],
    [new ContentPreconditionFailedError(), PreconditionFailedException],
  ])("maps bounded restoration errors to HTTP responses", async (failure, expected) => {
    const { controller, service } = fixture();
    service.restoreRevision.mockRejectedValue(failure);

    await expect(
      controller.restore(
        { identity: { user: { id: "actor-1" } } } as AuthenticatedRequest,
        "site-1",
        "entry-1",
        "2",
        '"7"',
        { setHeader: vi.fn() },
      ),
    ).rejects.toBeInstanceOf(expected);
  });

  it("requires an authenticated actor for restoration", async () => {
    const { controller } = fixture();

    await expect(
      controller.restore({} as AuthenticatedRequest, "site-1", "entry-1", "2", '"7"', {
        setHeader: vi.fn(),
      }),
    ).rejects.toBeInstanceOf(HttpException);
  });
});
