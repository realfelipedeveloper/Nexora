import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedRequest } from "../identity/session-authentication.guard.js";
import { PublicationSchedulesController } from "./publication-scheduler.controller.js";
import {
  InvalidPublicationScheduleError,
  PublicationScheduleConflictError,
  PublicationScheduleNotFoundError,
  type PublicationSchedulerService,
} from "./publication-scheduler.service.js";

const request = {
  headers: {},
  identity: {
    csrfToken: "csrf",
    expiresAt: new Date("2026-09-26T00:00:00.000Z"),
    sessionId: "session",
    user: {
      displayName: "Publisher",
      email: "publisher@example.com",
      id: "actor",
      isSystemAdmin: false,
    },
  },
} satisfies AuthenticatedRequest;

function fixture() {
  const service = { cancel: vi.fn(), create: vi.fn(), list: vi.fn() };
  return {
    controller: new PublicationSchedulesController(
      service as unknown as PublicationSchedulerService,
    ),
    service,
  };
}

describe("publication schedules controller", () => {
  it("delegates list, create, and cancel with actor and scope", async () => {
    const { controller, service } = fixture();
    service.list.mockResolvedValue({ items: [] });
    service.create.mockResolvedValue({ id: "schedule" });
    await controller.list("site", "entry", "10", "cursor");
    await controller.create(request, "site", "entry", "application/json", { action: "PUBLISH" });
    await controller.cancel(request, "site", "entry", "schedule");
    expect(service.list).toHaveBeenCalledWith("site", "entry", { cursor: "cursor", limit: "10" });
    expect(service.create).toHaveBeenCalledWith("actor", "site", "entry", { action: "PUBLISH" });
    expect(service.cancel).toHaveBeenCalledWith("actor", "site", "entry", "schedule");
  });

  it("rejects non-json writes and maps bounded domain failures", async () => {
    const { controller, service } = fixture();
    await expect(
      controller.create(request, "site", "entry", "text/plain", {}),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
    service.list.mockRejectedValue(new InvalidPublicationScheduleError());
    await expect(controller.list("site", "entry")).rejects.toBeInstanceOf(BadRequestException);
    service.create.mockRejectedValue(new PublicationScheduleConflictError());
    await expect(
      controller.create(request, "site", "entry", "application/json", {}),
    ).rejects.toBeInstanceOf(ConflictException);
    service.cancel.mockRejectedValue(new PublicationScheduleNotFoundError());
    await expect(controller.cancel(request, "site", "entry", "missing")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
