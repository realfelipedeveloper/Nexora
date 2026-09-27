import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  PayloadTooLargeException,
  PreconditionFailedException,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedRequest } from "../identity/session-authentication.guard.js";
import { MalwareDetectedError, MalwareScannerUnavailableError } from "./malware-scanner.js";
import { MediaController, PublicMediaController } from "./media.controller.js";
import {
  AssetInUseError,
  AssetNotFoundError,
  AssetPreconditionFailedError,
  InvalidMediaInputError,
  InvalidMediaPageError,
  type MediaService,
  UnsupportedAssetTypeError,
} from "./media.service.js";
import { InvalidMediaUploadError, MediaUploadTooLargeError } from "./media-upload.js";

const request = {
  headers: {},
  identity: {
    csrfToken: "csrf",
    expiresAt: new Date("2030-01-01T00:00:00.000Z"),
    sessionId: "session",
    user: {
      displayName: "Media Editor",
      email: "media@example.com",
      id: "actor",
      isSystemAdmin: false,
    },
  },
} satisfies AuthenticatedRequest;

function fixture() {
  const media = {
    delete: vi.fn(),
    get: vi.fn(),
    list: vi.fn(),
    readBySiteId: vi.fn(),
    readBySiteKey: vi.fn(),
    update: vi.fn(),
    upload: vi.fn(),
    usage: vi.fn(),
  };
  return {
    controller: new MediaController(media as unknown as MediaService),
    media,
    publicController: new PublicMediaController(media as unknown as MediaService),
  };
}

function response() {
  return {
    destroy: vi.fn(),
    setHeader: vi.fn(),
  };
}

function mediaObject() {
  const body = { on: vi.fn().mockReturnThis(), pipe: vi.fn() };
  return {
    body,
    result: {
      asset: {
        checksumSha256: "a".repeat(64),
        displayName: "asset.png",
        mimeType: "image/png",
        sizeBytes: 42,
      },
      object: { body },
    },
  };
}

describe("MediaController", () => {
  it("delegates site-scoped list, detail, usage, update and delete operations", async () => {
    const { controller, media } = fixture();
    media.list.mockResolvedValue({ items: [] });
    media.get.mockResolvedValue({ id: "asset" });
    media.usage.mockResolvedValue([{ id: "usage" }]);
    media.update.mockResolvedValue({ id: "asset", version: 3 });
    media.delete.mockResolvedValue(undefined);

    await expect(controller.list("site", "cursor", "20", "photo")).resolves.toEqual({
      items: [],
    });
    await expect(controller.get("site", "asset")).resolves.toEqual({ id: "asset" });
    await expect(controller.usage("site", "asset")).resolves.toEqual({
      items: [{ id: "usage" }],
    });
    await expect(
      controller.update(request, "site", "asset", '"2"', { displayName: "Updated" }),
    ).resolves.toEqual({ id: "asset", version: 3 });
    await expect(controller.delete(request, "site", "asset", '"3"')).resolves.toBeUndefined();

    expect(media.list).toHaveBeenCalledWith("site", {
      cursor: "cursor",
      limit: "20",
      query: "photo",
    });
    expect(media.update).toHaveBeenCalledWith("actor", "site", "asset", 2, {
      displayName: "Updated",
    });
    expect(media.delete).toHaveBeenCalledWith("actor", "site", "asset", 3);
  });

  it("streams private and public assets with distinct cache policies", async () => {
    const { controller, media, publicController } = fixture();
    const privateObject = mediaObject();
    const publicObject = mediaObject();
    media.readBySiteId.mockResolvedValue(privateObject.result);
    media.readBySiteKey.mockResolvedValue(publicObject.result);
    const privateResponse = response();
    const publicResponse = response();

    await controller.content("site", "asset", "2", privateResponse as never);
    await publicController.content("public-site", "asset", "3", publicResponse as never);

    expect(media.readBySiteId).toHaveBeenCalledWith("site", "asset", 2);
    expect(privateResponse.setHeader).toHaveBeenCalledWith("Cache-Control", "private, no-store");
    expect(privateObject.body.pipe).toHaveBeenCalledWith(privateResponse);
    expect(media.readBySiteKey).toHaveBeenCalledWith("public-site", "asset", 3);
    expect(publicResponse.setHeader).toHaveBeenCalledWith(
      "Cache-Control",
      "public, max-age=31536000, immutable",
    );
    expect(publicObject.body.pipe).toHaveBeenCalledWith(publicResponse);
  });

  it("rejects invalid versions, site keys, and optimistic concurrency headers", async () => {
    const { controller, publicController } = fixture();
    await expect(
      controller.content("site", "asset", "0", response() as never),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      publicController.content("Invalid Site", "asset", "1", response() as never),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.update(request, "site", "asset", "invalid", {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it.each([
    [new AssetNotFoundError(), NotFoundException],
    [new AssetInUseError(), ConflictException],
    [new AssetPreconditionFailedError(), PreconditionFailedException],
    [new MediaUploadTooLargeError(), PayloadTooLargeException],
    [new UnsupportedAssetTypeError(), UnsupportedMediaTypeException],
    [new MalwareDetectedError(), BadRequestException],
    [new MalwareScannerUnavailableError(), ServiceUnavailableException],
    [new InvalidMediaInputError(), BadRequestException],
    [new InvalidMediaUploadError(), BadRequestException],
    [new InvalidMediaPageError(), BadRequestException],
  ])("maps bounded media error %#", async (error, exception) => {
    const { controller, media } = fixture();
    media.list.mockRejectedValue(error);
    await expect(controller.list("site")).rejects.toBeInstanceOf(exception);
  });

  it("preserves existing HTTP exceptions", async () => {
    const { controller, media } = fixture();
    const forbidden = new ForbiddenException("Denied");
    media.list.mockRejectedValue(forbidden);
    await expect(controller.list("site")).rejects.toBe(forbidden);
  });

  it("rejects malformed multipart uploads before invoking media persistence", async () => {
    const { controller, media } = fixture();
    const malformedRequest = { ...request, headers: {}, pipe: vi.fn() };
    await expect(controller.upload("site", malformedRequest as never)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(media.upload).not.toHaveBeenCalled();
  });
});
