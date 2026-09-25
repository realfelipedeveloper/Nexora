import { describe, expect, it } from "vitest";
import {
  contentLocaleDataSchema,
  contentEntryAssignmentCreateSchema,
  contentEntryCommentCreateSchema,
  contentEntryCreateSchema,
  contentEntryReviewCreateSchema,
  contentEntrySnapshotLocalesSchema,
  contentEntryStatusSchema,
  contentEntryStatusUpdateSchema,
  contentEntryTransitionAuditMetadataSchema,
  contentEntryWorkflowTransitions,
  contentPlacementUpdateSchema,
  contentSchemaVersionSchema,
  contentTypeCreateSchema,
  contentTypeKeySchema,
  contentTypeSchemaDefinitionSchema,
  fieldDefinitionSchema,
  findContentEntryWorkflowTransition,
  menuCreateSchema,
  menuItemWriteSchema,
  redirectCreateSchema,
  publicationScheduleCreateSchema,
  routeCreateSchema,
  routePathSchema,
  routeUpdateSchema,
  sectionCreateSchema,
  sectionRoleAssignmentCreateSchema,
  sectionUpdateSchema,
} from "./index.js";

describe("content modeling contracts", () => {
  it("accepts canonical content type keys and rejects ambiguous identifiers", () => {
    expect(contentTypeKeySchema.parse("institutional-page")).toBe("institutional-page");
    expect(contentTypeKeySchema.safeParse("Institutional Page").success).toBe(false);
    expect(contentTypeKeySchema.safeParse("content_type").success).toBe(false);
  });

  it("keeps field definitions bounded, typed, and object-configured", () => {
    expect(
      fieldDefinitionSchema.parse({
        fieldType: "richText",
        key: "body",
        label: "Body",
      }),
    ).toEqual({
      config: {},
      fieldType: "richText",
      key: "body",
      label: "Body",
      position: 0,
      required: false,
    });

    expect(
      fieldDefinitionSchema.safeParse({
        config: [],
        fieldType: "richText",
        key: "body",
        label: "Body",
      }).success,
    ).toBe(false);
    expect(
      fieldDefinitionSchema.safeParse({
        fieldType: "unsupported",
        key: "body",
        label: "Body",
      }).success,
    ).toBe(false);
  });

  it("requires object content data and positive schema versions", () => {
    expect(contentLocaleDataSchema.safeParse({ title: "Nexora" }).success).toBe(true);
    expect(contentLocaleDataSchema.safeParse(["Nexora"]).success).toBe(false);
    expect(contentSchemaVersionSchema.safeParse(1).success).toBe(true);
    expect(contentSchemaVersionSchema.safeParse(0).success).toBe(false);
  });

  it("validates bounded immutable snapshot locale data", () => {
    const locale = {
      data: { title: "Original title" },
      localeCode: "  pt-BR  ",
      localeId: "2ec3cb32-e8c8-4c64-ad0f-8689e39a06a6",
      schemaVersion: 2,
    };
    expect(contentEntrySnapshotLocalesSchema.parse([locale])).toEqual([
      { ...locale, localeCode: "pt-BR" },
    ]);
    expect(contentEntrySnapshotLocalesSchema.safeParse([]).success).toBe(false);
    expect(contentEntrySnapshotLocalesSchema.safeParse([locale, locale]).success).toBe(false);
  });

  it("accepts bounded, typed schema snapshots for a content type version", () => {
    expect(
      contentTypeSchemaDefinitionSchema.parse({
        displayName: "Institutional Page",
        fields: [{ fieldType: "text", key: "title", label: "Title" }],
        key: "institutional-page",
        version: 2,
      }),
    ).toMatchObject({
      fields: [{ key: "title", position: 0 }],
      version: 2,
    });
    expect(
      contentTypeSchemaDefinitionSchema.safeParse({
        displayName: "Institutional Page",
        fields: [],
        key: "institutional-page",
        version: 0,
      }).success,
    ).toBe(false);
  });

  it("rejects duplicated fields and configuration that does not match the field type", () => {
    expect(
      contentTypeSchemaDefinitionSchema.safeParse({
        displayName: "Article",
        fields: [
          { fieldType: "text", key: "title", label: "Title" },
          { fieldType: "text", key: "title", label: "Duplicate title" },
        ],
        key: "article",
        version: 1,
      }).success,
    ).toBe(false);
    expect(
      fieldDefinitionSchema.safeParse({
        config: { options: [] },
        fieldType: "select",
        key: "kind",
        label: "Kind",
      }).success,
    ).toBe(false);
  });

  it("validates strict administrative content commands", () => {
    const localeId = "2ec3cb32-e8c8-4c64-ad0f-8689e39a06a6";
    expect(
      contentTypeCreateSchema.safeParse({
        displayName: "Article",
        fields: [{ fieldType: "text", key: "title", label: "Title" }],
        key: "article",
      }).success,
    ).toBe(true);
    expect(
      contentEntryCreateSchema.safeParse({
        contentTypeId: "a11f740b-f15f-4279-8ca2-3877a4cae775",
        locales: [
          { data: { title: "First" }, localeId },
          { data: { title: "Duplicate" }, localeId },
        ],
      }).success,
    ).toBe(false);
    expect(
      contentEntryCreateSchema.safeParse({
        contentTypeId: "not-a-uuid",
        locales: [],
        unexpected: true,
      }).success,
    ).toBe(false);
  });

  it("models the bounded editorial workflow states", () => {
    expect(contentEntryStatusSchema.options).toEqual([
      "DRAFT",
      "IN_REVIEW",
      "PUBLISHED",
      "ARCHIVED",
    ]);
    for (const status of contentEntryStatusSchema.options) {
      expect(contentEntryStatusUpdateSchema.parse({ status })).toEqual({ status });
    }
    expect(contentEntryStatusUpdateSchema.safeParse({ status: "SCHEDULED" }).success).toBe(false);
    expect(
      contentEntryStatusUpdateSchema.safeParse({ reason: "not persisted", status: "DRAFT" })
        .success,
    ).toBe(false);
  });

  it("defines every allowed workflow edge explicitly", () => {
    expect(contentEntryWorkflowTransitions).toEqual([
      { action: "SUBMIT_FOR_REVIEW", from: "DRAFT", to: "IN_REVIEW" },
      { action: "RETURN_TO_DRAFT", from: "IN_REVIEW", to: "DRAFT" },
      { action: "PUBLISH", from: "IN_REVIEW", to: "PUBLISHED" },
      { action: "UNPUBLISH", from: "PUBLISHED", to: "DRAFT" },
      { action: "ARCHIVE", from: "PUBLISHED", to: "ARCHIVED" },
      { action: "RESTORE", from: "ARCHIVED", to: "DRAFT" },
    ]);
    expect(findContentEntryWorkflowTransition("DRAFT", "IN_REVIEW")).toMatchObject({
      action: "SUBMIT_FOR_REVIEW",
    });
    expect(findContentEntryWorkflowTransition("DRAFT", "PUBLISHED")).toBeUndefined();
    expect(findContentEntryWorkflowTransition("ARCHIVED", "PUBLISHED")).toBeUndefined();
  });

  it.each([
    ["DRAFT", "PUBLISHED"],
    ["DRAFT", "ARCHIVED"],
    ["IN_REVIEW", "ARCHIVED"],
    ["PUBLISHED", "IN_REVIEW"],
    ["ARCHIVED", "IN_REVIEW"],
    ["ARCHIVED", "PUBLISHED"],
  ] as const)("rejects the invalid workflow edge %s -> %s", (from, to) => {
    expect(findContentEntryWorkflowTransition(from, to)).toBeUndefined();
  });

  it("validates the audit contract for every workflow transition", () => {
    for (const [index, transition] of contentEntryWorkflowTransitions.entries()) {
      expect(
        contentEntryTransitionAuditMetadataSchema.parse({
          from: transition.from,
          previousRevision: index + 1,
          revision: index + 2,
          siteId: "a11f740b-f15f-4279-8ca2-3877a4cae775",
          to: transition.to,
          transition: transition.action,
        }),
      ).toMatchObject({
        from: transition.from,
        to: transition.to,
        transition: transition.action,
      });
    }
    expect(
      contentEntryTransitionAuditMetadataSchema.safeParse({
        from: "DRAFT",
        previousRevision: 1,
        revision: 2,
        siteId: "a11f740b-f15f-4279-8ca2-3877a4cae775",
        to: "IN_REVIEW",
        transition: "PUBLISH",
      }).success,
    ).toBe(false);
    expect(
      contentEntryTransitionAuditMetadataSchema.safeParse({
        from: "DRAFT",
        previousRevision: 1,
        revision: 3,
        siteId: "a11f740b-f15f-4279-8ca2-3877a4cae775",
        to: "IN_REVIEW",
        transition: "SUBMIT_FOR_REVIEW",
      }).success,
    ).toBe(false);
  });

  it("validates bounded editorial assignments and comments", () => {
    expect(
      contentEntryAssignmentCreateSchema.parse({
        assigneeId: "a11f740b-f15f-4279-8ca2-3877a4cae775",
      }),
    ).toEqual({ assigneeId: "a11f740b-f15f-4279-8ca2-3877a4cae775" });
    expect(contentEntryAssignmentCreateSchema.safeParse({ assigneeId: "not-a-uuid" }).success).toBe(
      false,
    );
    expect(contentEntryCommentCreateSchema.parse({ body: "  Review the title.  " })).toEqual({
      body: "Review the title.",
    });
    expect(contentEntryCommentCreateSchema.safeParse({ body: "   " }).success).toBe(false);
    expect(contentEntryCommentCreateSchema.safeParse({ body: "x".repeat(4_001) }).success).toBe(
      false,
    );
  });

  it("requires a bounded reason only when editorial changes are requested", () => {
    expect(contentEntryReviewCreateSchema.parse({ decision: "APPROVED" })).toEqual({
      decision: "APPROVED",
    });
    expect(
      contentEntryReviewCreateSchema.parse({
        decision: "CHANGES_REQUESTED",
        note: "  Clarify the publication date.  ",
      }),
    ).toEqual({
      decision: "CHANGES_REQUESTED",
      note: "Clarify the publication date.",
    });
    expect(
      contentEntryReviewCreateSchema.safeParse({ decision: "CHANGES_REQUESTED" }).success,
    ).toBe(false);
    expect(
      contentEntryReviewCreateSchema.safeParse({
        decision: "APPROVED",
        note: "x".repeat(4_001),
      }).success,
    ).toBe(false);
  });

  it("validates sections, placements, and section-scoped roles", () => {
    const sectionId = "a11f740b-f15f-4279-8ca2-3877a4cae775";
    const userId = "2ec3cb32-e8c8-4c64-ad0f-8689e39a06a6";

    expect(sectionCreateSchema.parse({ key: "latest-news", name: " Latest news " })).toEqual({
      key: "latest-news",
      name: "Latest news",
      parentId: null,
    });
    expect(sectionCreateSchema.safeParse({ key: "Latest News", name: "News" }).success).toBe(false);
    expect(sectionUpdateSchema.parse({ name: "Local", parentId: sectionId })).toEqual({
      name: "Local",
      parentId: sectionId,
    });
    expect(contentPlacementUpdateSchema.parse({ isPrimary: true, position: 4 })).toEqual({
      isPrimary: true,
      isVisible: true,
      position: 4,
    });
    expect(contentPlacementUpdateSchema.safeParse({ position: -1 }).success).toBe(false);
    expect(sectionRoleAssignmentCreateSchema.parse({ roleKey: "editor", userId })).toEqual({
      roleKey: "editor",
      userId,
    });
    expect(sectionRoleAssignmentCreateSchema.safeParse({ roleKey: "owner", userId }).success).toBe(
      false,
    );
  });

  it("validates navigation targets and normalized route paths", () => {
    const localeId = "a11f740b-f15f-4279-8ca2-3877a4cae775";
    const routeId = "2ec3cb32-e8c8-4c64-ad0f-8689e39a06a6";

    expect(menuCreateSchema.parse({ key: "main", localeId, name: " Principal " })).toEqual({
      key: "main",
      localeId,
      name: "Principal",
    });
    expect(routePathSchema.safeParse("/noticias/institucional").success).toBe(true);
    expect(routePathSchema.safeParse("/Noticias?draft=true").success).toBe(false);
    expect(
      menuItemWriteSchema.parse({ label: "Início", linkType: "INTERNAL", routeId }),
    ).toMatchObject({ externalUrl: null, isVisible: true, routeId });
    expect(
      menuItemWriteSchema.safeParse({
        externalUrl: "https://example.com",
        label: "Inválido",
        linkType: "INTERNAL",
        routeId,
      }).success,
    ).toBe(false);
    expect(
      menuItemWriteSchema.parse({
        externalUrl: "https://example.com",
        label: "Externo",
        linkType: "EXTERNAL",
      }),
    ).toMatchObject({ externalUrl: "https://example.com", routeId: null });
    expect(
      menuItemWriteSchema.safeParse({
        externalUrl: "javascript:alert(1)",
        label: "Inseguro",
        linkType: "EXTERNAL",
      }).success,
    ).toBe(false);
  });

  it("validates route and redirect contracts", () => {
    const localeId = "a11f740b-f15f-4279-8ca2-3877a4cae775";
    expect(routeCreateSchema.parse({ localeId, path: "/sobre" })).toEqual({
      contentEntryId: null,
      localeId,
      path: "/sobre",
    });
    expect(routeUpdateSchema.safeParse({ contentEntryId: null, path: "/nova-rota" }).success).toBe(
      true,
    );
    expect(
      redirectCreateSchema.parse({ localeId, sourcePath: "/antiga", targetPath: "/nova" }),
    ).toMatchObject({ statusCode: 301 });
    expect(
      redirectCreateSchema.safeParse({ localeId, sourcePath: "/igual", targetPath: "/igual" })
        .success,
    ).toBe(false);
  });

  it("validates publication schedules with explicit idempotency commands", () => {
    const commandId = "a11f740b-f15f-4279-8ca2-3877a4cae775";
    expect(
      publicationScheduleCreateSchema.parse({
        action: "PUBLISH",
        commandId,
        scheduledFor: "2026-09-26T10:00:00-03:00",
      }),
    ).toEqual({
      action: "PUBLISH",
      commandId,
      scheduledFor: new Date("2026-09-26T13:00:00.000Z"),
    });
    expect(
      publicationScheduleCreateSchema.safeParse({
        action: "DELETE",
        commandId,
        scheduledFor: "tomorrow",
      }).success,
    ).toBe(false);
  });
});
