import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedRequest } from "../identity/session-authentication.guard.js";
import { ContentEntriesController, ContentTypesController } from "./content-admin.controller.js";
import {
  type ContentAdminService,
  ContentEntryNotFoundError,
  ContentTypeConflictError,
  ContentTypeInUseError,
  ContentTypeNotFoundError,
  InvalidContentInputError,
  InvalidContentPageError,
} from "./content-admin.service.js";
import { ContentDataInvalidError, ContentDataTooLargeError } from "./content-field-validator.js";

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
    createContentEntry: vi.fn(),
    createContentType: vi.fn(),
    deleteContentEntry: vi.fn(),
    deleteContentType: vi.fn(),
    getContentEntry: vi.fn(),
    getContentType: vi.fn(),
    listContentEntries: vi.fn(),
    listContentTypes: vi.fn(),
    updateContentEntry: vi.fn(),
    updateContentType: vi.fn(),
  };
  return {
    entries: new ContentEntriesController(service as unknown as ContentAdminService),
    service,
    types: new ContentTypesController(service as unknown as ContentAdminService),
  };
}

describe("content administration controllers", () => {
  it("keeps site scope and bounded pagination in list calls", async () => {
    const { entries, service, types } = fixture();
    service.listContentTypes.mockResolvedValue({ items: [] });
    service.listContentEntries.mockResolvedValue({ items: [] });

    await types.list("site-1", "10", "type-cursor");
    expect(service.listContentTypes).toHaveBeenCalledWith("site-1", {
      cursor: "type-cursor",
      limit: "10",
    });
    await entries.list("site-1", "20", "entry-cursor", "type-1");
    expect(service.listContentEntries).toHaveBeenCalledWith("site-1", {
      contentTypeId: "type-1",
      cursor: "entry-cursor",
      limit: "20",
    });
  });

  it("passes only the authenticated actor and site into mutations", async () => {
    const { entries, service, types } = fixture();
    service.createContentType.mockResolvedValue({ id: "type-1" });
    service.createContentEntry.mockResolvedValue({ id: "entry-1" });

    await types.create(request, "site-1", "application/json; charset=utf-8", {
      displayName: "Article",
      fields: [],
      key: "article",
    });
    expect(service.createContentType).toHaveBeenCalledWith("admin-1", "site-1", {
      displayName: "Article",
      fields: [],
      key: "article",
    });

    await entries.create(request, "site-1", "application/json", {
      contentTypeId: "type-1",
      locales: [],
    });
    expect(service.createContentEntry).toHaveBeenCalledWith("admin-1", "site-1", {
      contentTypeId: "type-1",
      locales: [],
    });
  });

  it("rejects non-JSON writes before calling the service", async () => {
    const { service, types } = fixture();
    await expect(types.create(request, "site-1", "text/plain", {})).rejects.toBeInstanceOf(
      UnsupportedMediaTypeException,
    );
    expect(service.createContentType).not.toHaveBeenCalled();
  });

  it.each([
    [new InvalidContentInputError(), BadRequestException],
    [new InvalidContentPageError(), BadRequestException],
    [new ContentDataInvalidError([]), BadRequestException],
    [new ContentDataTooLargeError(), PayloadTooLargeException],
    [new ContentTypeNotFoundError(), NotFoundException],
    [new ContentEntryNotFoundError(), NotFoundException],
    [new ContentTypeConflictError(), ConflictException],
    [new ContentTypeInUseError(), ConflictException],
  ])("maps domain errors to bounded HTTP responses", async (failure, expected) => {
    const { service, types } = fixture();
    service.getContentType.mockRejectedValue(failure);
    await expect(types.get("site-1", "type-1")).rejects.toBeInstanceOf(expected);
  });

  it("delegates updates and deletes without returning deleted content", async () => {
    const { entries, service, types } = fixture();
    service.updateContentType.mockResolvedValue({ id: "type-1", schemaVersion: 2 });
    service.updateContentEntry.mockResolvedValue({ id: "entry-1", revision: 2 });
    service.deleteContentType.mockResolvedValue(undefined);
    service.deleteContentEntry.mockResolvedValue(undefined);

    await types.update(request, "site-1", "type-1", "application/json", {
      displayName: "Article",
      fields: [],
    });
    await entries.update(request, "site-1", "entry-1", "application/json", { locales: [] });
    await expect(types.delete(request, "site-1", "type-1")).resolves.toBeUndefined();
    await expect(entries.delete(request, "site-1", "entry-1")).resolves.toBeUndefined();
  });
});
