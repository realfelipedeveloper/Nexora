import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedRequest } from "../identity/session-authentication.guard.js";
import {
  InvalidSiteLifecycleInputError,
  SiteKeyConflictError,
  type SiteLifecycleService,
  SiteNotFoundError,
} from "./site-lifecycle.service.js";
import { SitesController } from "./sites.controller.js";

const request = {
  headers: {},
  identity: {
    csrfToken: "csrf",
    expiresAt: new Date("2026-01-01T01:00:00Z"),
    sessionId: "session-1",
    user: {
      displayName: "Felipe",
      email: "felipe@nexora.local",
      id: "admin-1",
      isSystemAdmin: true,
    },
  },
} satisfies AuthenticatedRequest;

function fixture() {
  const service = {
    create: vi.fn(),
    get: vi.fn(),
    listAccessible: vi.fn(),
    updateStatus: vi.fn(),
  };
  return {
    controller: new SitesController(service as unknown as SiteLifecycleService),
    service,
  };
}

describe("SitesController", () => {
  it("lists sites in the authenticated identity scope", async () => {
    const { controller, service } = fixture();
    await controller.list(request);
    expect(service.listAccessible).toHaveBeenCalledWith("admin-1", true);
  });

  it("requires JSON and passes only the authenticated actor to creation", async () => {
    const { controller, service } = fixture();
    service.create.mockResolvedValue({ id: "site-1" });

    await expect(
      controller.create(request, "application/json; charset=utf-8", {
        key: "main-site",
        name: "Main Site",
      }),
    ).resolves.toEqual({ id: "site-1" });
    expect(service.create).toHaveBeenCalledWith("admin-1", {
      key: "main-site",
      name: "Main Site",
    });
    await expect(controller.create(request, "text/plain", {})).rejects.toBeInstanceOf(
      UnsupportedMediaTypeException,
    );
  });

  it.each([
    [new InvalidSiteLifecycleInputError(), BadRequestException],
    [new SiteKeyConflictError(), ConflictException],
    [new SiteNotFoundError(), NotFoundException],
  ])("maps lifecycle errors without exposing internals", async (failure, expected) => {
    const { controller, service } = fixture();
    service.create.mockRejectedValue(failure);
    await expect(controller.create(request, "application/json", {})).rejects.toBeInstanceOf(
      expected,
    );
  });

  it("loads a site and changes its status through the lifecycle service", async () => {
    const { controller, service } = fixture();
    service.get.mockResolvedValue({ id: "site-1" });
    service.updateStatus.mockResolvedValue({ id: "site-1", status: "ARCHIVED" });

    await expect(controller.get("site-1")).resolves.toEqual({ id: "site-1" });
    await expect(
      controller.updateStatus(request, "site-1", "application/json", { status: "ARCHIVED" }),
    ).resolves.toEqual({ id: "site-1", status: "ARCHIVED" });
    expect(service.updateStatus).toHaveBeenCalledWith("admin-1", "site-1", {
      status: "ARCHIVED",
    });
  });
});
