import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { SectionScopedRequest } from "../identity/section-authorization.guard.js";
import { SectionPlacementsController, SectionsController } from "./section-placement.controller.js";
import {
  InvalidSectionInputError,
  PlacementConflictError,
  SectionNotFoundError,
  type SectionPlacementService,
} from "./section-placement.service.js";

const request = {
  headers: {},
  identity: {
    csrfToken: "csrf",
    expiresAt: new Date("2026-01-01T00:00:00Z"),
    sessionId: "session-1",
    user: {
      displayName: "Editor",
      email: "editor@example.com",
      id: "actor-1",
      isSystemAdmin: false,
    },
  },
} satisfies SectionScopedRequest;

function fixture() {
  const service = {
    createRoleAssignment: vi.fn(),
    createSection: vi.fn(),
    deletePlacement: vi.fn(),
    deleteRoleAssignment: vi.fn(),
    deleteSection: vi.fn(),
    getSection: vi.fn(),
    listPlacements: vi.fn(),
    listRoleAssignments: vi.fn(),
    listSections: vi.fn(),
    putPlacement: vi.fn(),
    updateSection: vi.fn(),
  };
  return {
    placements: new SectionPlacementsController(service as unknown as SectionPlacementService),
    sections: new SectionsController(service as unknown as SectionPlacementService),
    service,
  };
}

describe("section and placement controllers", () => {
  it("delegates bounded section and placement operations with actor and scope", async () => {
    const { placements, sections, service } = fixture();
    service.listSections.mockResolvedValue({ items: [] });
    service.putPlacement.mockResolvedValue({ id: "placement-1" });

    await sections.list("site-1", "20", "cursor-1", "root");
    expect(service.listSections).toHaveBeenCalledWith("site-1", {
      cursor: "cursor-1",
      limit: "20",
      parentId: "root",
    });
    await placements.put(request, "site-1", "section-1", "entry-1", "application/json", {
      isPrimary: true,
      isVisible: true,
      position: 2,
    });
    expect(service.putPlacement).toHaveBeenCalledWith("actor-1", "site-1", "section-1", "entry-1", {
      isPrimary: true,
      isVisible: true,
      position: 2,
    });
  });

  it("rejects non-json mutations", async () => {
    const { sections, service } = fixture();
    await expect(sections.create(request, "site-1", "text/plain", {})).rejects.toBeInstanceOf(
      UnsupportedMediaTypeException,
    );
    expect(service.createSection).not.toHaveBeenCalled();
  });

  it.each([
    [new InvalidSectionInputError(), BadRequestException],
    [new SectionNotFoundError(), NotFoundException],
    [new PlacementConflictError(), ConflictException],
  ])("maps section domain errors to bounded responses", async (failure, expected) => {
    const { sections, service } = fixture();
    service.getSection.mockRejectedValue(failure);
    await expect(sections.get("site-1", "section-1")).rejects.toBeInstanceOf(expected);
  });
});
