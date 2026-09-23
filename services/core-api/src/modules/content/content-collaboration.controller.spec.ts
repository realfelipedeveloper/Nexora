import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedRequest } from "../identity/session-authentication.guard.js";
import { ContentEntryNotFoundError, InvalidContentInputError } from "./content-admin.service.js";
import { ContentCollaborationController } from "./content-collaboration.controller.js";
import {
  type ContentCollaborationService,
  ContentEntryAssigneeUnavailableError,
  ContentEntryAssignmentConflictError,
  ContentEntryAssignmentNotFoundError,
} from "./content-collaboration.service.js";

const request = {
  headers: {},
  identity: {
    csrfToken: "csrf",
    expiresAt: new Date("2026-01-01T01:00:00Z"),
    sessionId: "session-1",
    user: {
      displayName: "Publisher",
      email: "publisher@example.com",
      id: "actor-1",
      isSystemAdmin: false,
    },
  },
} satisfies AuthenticatedRequest;

function fixture() {
  const service = {
    createAssignment: vi.fn(),
    createComment: vi.fn(),
    deleteAssignment: vi.fn(),
    listAssignments: vi.fn(),
    listComments: vi.fn(),
  };
  return {
    controller: new ContentCollaborationController(
      service as unknown as ContentCollaborationService,
    ),
    service,
  };
}

describe("content collaboration controller", () => {
  it("preserves site and entry scope in paginated reads", async () => {
    const { controller, service } = fixture();
    service.listAssignments.mockResolvedValue({ items: [] });
    service.listComments.mockResolvedValue({ items: [] });

    await controller.listAssignments("site-1", "entry-1", "10", "assignment-cursor");
    expect(service.listAssignments).toHaveBeenCalledWith("site-1", "entry-1", {
      cursor: "assignment-cursor",
      limit: "10",
    });
    await controller.listComments("site-1", "entry-1", "20", "comment-cursor");
    expect(service.listComments).toHaveBeenCalledWith("site-1", "entry-1", {
      cursor: "comment-cursor",
      limit: "20",
    });
  });

  it("passes only the authenticated actor and route scope into writes", async () => {
    const { controller, service } = fixture();
    service.createAssignment.mockResolvedValue({ id: "assignment-1" });
    service.createComment.mockResolvedValue({ id: "comment-1" });
    service.deleteAssignment.mockResolvedValue(undefined);

    await controller.createAssignment(request, "site-1", "entry-1", "application/json", {
      assigneeId: "assignee-1",
    });
    expect(service.createAssignment).toHaveBeenCalledWith("actor-1", "site-1", "entry-1", {
      assigneeId: "assignee-1",
    });
    await controller.createComment(request, "site-1", "entry-1", "application/json", {
      body: "Review this entry.",
    });
    expect(service.createComment).toHaveBeenCalledWith("actor-1", "site-1", "entry-1", {
      body: "Review this entry.",
    });
    await controller.deleteAssignment(request, "site-1", "entry-1", "assignment-1");
    expect(service.deleteAssignment).toHaveBeenCalledWith(
      "actor-1",
      "site-1",
      "entry-1",
      "assignment-1",
    );
  });

  it("rejects non-JSON collaboration writes", async () => {
    const { controller, service } = fixture();
    await expect(
      controller.createComment(request, "site-1", "entry-1", "text/plain", {}),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
    expect(service.createComment).not.toHaveBeenCalled();
  });

  it.each([
    [new InvalidContentInputError(), BadRequestException],
    [new ContentEntryNotFoundError(), NotFoundException],
    [new ContentEntryAssignmentNotFoundError(), NotFoundException],
    [new ContentEntryAssigneeUnavailableError(), NotFoundException],
    [new ContentEntryAssignmentConflictError(), ConflictException],
  ])("maps collaboration errors to bounded HTTP responses", async (failure, expected) => {
    const { controller, service } = fixture();
    service.createComment.mockRejectedValue(failure);
    await expect(
      controller.createComment(request, "site-1", "entry-1", "application/json", {
        body: "Review this entry.",
      }),
    ).rejects.toBeInstanceOf(expected);
  });
});
