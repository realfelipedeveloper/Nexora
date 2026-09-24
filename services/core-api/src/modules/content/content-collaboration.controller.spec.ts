import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  PreconditionFailedException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { SiteScopedRequest } from "../identity/site-authorization.guard.js";
import {
  ContentEntryNotFoundError,
  ContentPreconditionFailedError,
  InvalidContentInputError,
} from "./content-admin.service.js";
import { ContentCollaborationController } from "./content-collaboration.controller.js";
import {
  type ContentCollaborationService,
  ContentEntryAssigneeUnavailableError,
  ContentEntryAssignmentConflictError,
  ContentEntryAssignmentNotFoundError,
  ContentEntryReviewConflictError,
  ContentEntryReviewForbiddenError,
  ContentEntryReviewStateConflictError,
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
  siteAccess: {
    isSystemAdmin: false,
    permissionKeys: ["content.read", "content.write", "content.publish"],
    roleKeys: ["publisher"],
    siteId: "site-1",
  },
} satisfies SiteScopedRequest;

function headerResponse() {
  return { setHeader: vi.fn() };
}

function fixture() {
  const service = {
    createAssignment: vi.fn(),
    createComment: vi.fn(),
    deleteAssignment: vi.fn(),
    listAssignments: vi.fn(),
    listComments: vi.fn(),
    listReviews: vi.fn(),
    createReview: vi.fn(),
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
    service.listReviews.mockResolvedValue({ items: [] });

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
    await controller.listReviews("site-1", "entry-1", "30", "review-cursor");
    expect(service.listReviews).toHaveBeenCalledWith("site-1", "entry-1", {
      cursor: "review-cursor",
      limit: "30",
    });
  });

  it("passes only the authenticated actor and route scope into writes", async () => {
    const { controller, service } = fixture();
    service.createAssignment.mockResolvedValue({ id: "assignment-1" });
    service.createComment.mockResolvedValue({ id: "comment-1" });
    service.deleteAssignment.mockResolvedValue(undefined);
    service.createReview.mockResolvedValue({
      entry: { revision: 3 },
      review: { id: "review-1" },
    });

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
    const response = headerResponse();
    await controller.createReview(
      request,
      "site-1",
      "entry-1",
      "application/json",
      '"3"',
      { decision: "APPROVED" },
      response,
    );
    expect(service.createReview).toHaveBeenCalledWith(
      "actor-1",
      "site-1",
      request.siteAccess,
      "entry-1",
      3,
      { decision: "APPROVED" },
    );
    expect(response.setHeader).toHaveBeenCalledWith("ETag", '"3"');
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
    [new ContentEntryReviewConflictError(), ConflictException],
    [new ContentEntryReviewStateConflictError(), ConflictException],
    [new ContentEntryReviewForbiddenError(), ForbiddenException],
    [new ContentPreconditionFailedError(), PreconditionFailedException],
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
