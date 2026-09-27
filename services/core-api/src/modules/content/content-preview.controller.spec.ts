import { BadRequestException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedRequest } from "../identity/session-authentication.guard.js";
import { ContentPreviewController } from "./content-preview.controller.js";
import {
  ContentPreviewNotFoundError,
  InvalidContentPreviewRequestError,
  type ContentPreviewService,
} from "./content-preview.service.js";
import type { MediaService } from "./media.service.js";

const request = {
  headers: {},
  identity: {
    csrfToken: "csrf",
    expiresAt: new Date("2026-09-26T23:00:00.000Z"),
    sessionId: "session",
    user: {
      displayName: "Editor",
      email: "editor@example.com",
      id: "actor",
      isSystemAdmin: false,
    },
  },
} satisfies AuthenticatedRequest;

function fixture() {
  const previews = { authorizeAsset: vi.fn(), issue: vi.fn(), redeem: vi.fn() };
  const media = { readBySiteId: vi.fn() };
  const response = { setHeader: vi.fn() };
  return {
    controller: new ContentPreviewController(
      previews as unknown as ContentPreviewService,
      media as unknown as MediaService,
    ),
    previews,
    response,
  };
}

describe("ContentPreviewController", () => {
  it("issues a site-scoped preview with private no-store response headers", async () => {
    const { controller, previews, response } = fixture();
    previews.issue.mockResolvedValue({ expiresAt: "soon", token: "opaque" });

    await expect(
      controller.issue(request, "site", "entry", { localeId: "locale" }, response),
    ).resolves.toEqual({ expiresAt: "soon", token: "opaque" });
    expect(previews.issue).toHaveBeenCalledWith("actor", "site", "entry", {
      localeId: "locale",
    });
    expect(response.setHeader).toHaveBeenCalledWith(
      "Cache-Control",
      "private, no-store, max-age=0",
    );
    expect(response.setHeader).toHaveBeenCalledWith("Referrer-Policy", "no-referrer");
    expect(response.setHeader).toHaveBeenCalledWith("X-Robots-Tag", "noindex, nofollow, noarchive");
  });

  it("redeems a bearer token without an administrative request context", async () => {
    const { controller, previews, response } = fixture();
    previews.redeem.mockResolvedValue({ id: "entry", status: "DRAFT" });
    await expect(controller.redeem("token", response)).resolves.toEqual({
      id: "entry",
      status: "DRAFT",
    });
  });

  it("maps invalid issuance and unavailable tokens to bounded responses", async () => {
    const { controller, previews, response } = fixture();
    previews.issue.mockRejectedValue(new InvalidContentPreviewRequestError());
    await expect(controller.issue(request, "site", "entry", {}, response)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    previews.redeem.mockRejectedValue(new ContentPreviewNotFoundError());
    await expect(controller.redeem("missing", response)).rejects.toBeInstanceOf(NotFoundException);
  });
});
