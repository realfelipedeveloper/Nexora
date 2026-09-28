import { ConflictException, UnsupportedMediaTypeException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedRequest } from "../identity/session-authentication.guard.js";
import { LocaleManagementController } from "./locale-management.controller.js";
import { LocaleConflictError, type LocaleManagementService } from "./locale-management.service.js";

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
    delete: vi.fn(),
    list: vi.fn(),
    update: vi.fn(),
  };
  return {
    controller: new LocaleManagementController(service as unknown as LocaleManagementService),
    response: { setHeader: vi.fn() },
    service,
  };
}

describe("LocaleManagementController", () => {
  it("returns the locale version as an ETag after creation", async () => {
    const { controller, response, service } = fixture();
    service.create.mockResolvedValue({ code: "pt-BR", version: 1 });

    await expect(
      controller.create(request, "site-1", "application/json", { code: "pt-BR" }, response),
    ).resolves.toEqual({ code: "pt-BR", version: 1 });
    expect(service.create).toHaveBeenCalledWith("admin-1", "site-1", { code: "pt-BR" });
    expect(response.setHeader).toHaveBeenCalledWith("ETag", '"1"');
  });

  it("requires a valid version precondition for updates", async () => {
    const { controller, response, service } = fixture();

    await expect(
      controller.update(
        request,
        "site-1",
        "locale-1",
        "application/json",
        undefined,
        { isDefault: true },
        response,
      ),
    ).rejects.toMatchObject({ status: 428 });
    expect(service.update).not.toHaveBeenCalled();
  });

  it("maps domain conflicts and rejects non-JSON mutations", async () => {
    const { controller, response, service } = fixture();
    service.update.mockRejectedValue(new LocaleConflictError());

    await expect(
      controller.update(
        request,
        "site-1",
        "locale-1",
        "application/json",
        '"2"',
        { isDefault: true },
        response,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      controller.create(request, "site-1", "text/plain", {}, response),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
  });
});
