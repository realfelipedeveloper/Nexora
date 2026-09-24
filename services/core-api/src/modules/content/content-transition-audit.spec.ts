import { contentEntryWorkflowTransitions } from "@nexora/schemas";
import { describe, expect, it } from "vitest";
import {
  contentEntryTransitionAuditData,
  contentEntryTransitionAuditRecord,
  InvalidContentEntryTransitionAuditError,
} from "./content-transition-audit.js";

describe("content transition audit", () => {
  it.each(contentEntryWorkflowTransitions)("builds bounded metadata for $action", (transition) => {
    expect(
      contentEntryTransitionAuditData({
        actorId: "actor-1",
        contentEntryId: "entry-1",
        previousRevision: 3,
        revision: 4,
        siteId: "a11f740b-f15f-4279-8ca2-3877a4cae775",
        transition,
      }),
    ).toEqual({
      action: "content.entry.status.changed",
      actorId: "actor-1",
      entity: "ContentEntry",
      entityId: "entry-1",
      metadata: {
        from: transition.from,
        previousRevision: 3,
        revision: 4,
        siteId: "a11f740b-f15f-4279-8ca2-3877a4cae775",
        to: transition.to,
        transition: transition.action,
      },
    });
  });

  it("projects valid stored metadata without exposing unrelated audit data", () => {
    const createdAt = new Date("2026-09-24T12:00:00Z");
    expect(
      contentEntryTransitionAuditRecord({
        actorId: "actor-1",
        createdAt,
        id: "audit-1",
        metadata: {
          from: "DRAFT",
          previousRevision: 1,
          revision: 2,
          siteId: "a11f740b-f15f-4279-8ca2-3877a4cae775",
          to: "IN_REVIEW",
          transition: "SUBMIT_FOR_REVIEW",
        },
      }),
    ).toEqual({
      actorId: "actor-1",
      createdAt,
      from: "DRAFT",
      id: "audit-1",
      previousRevision: 1,
      revision: 2,
      siteId: "a11f740b-f15f-4279-8ca2-3877a4cae775",
      to: "IN_REVIEW",
      transition: "SUBMIT_FOR_REVIEW",
    });
  });

  it("rejects malformed stored metadata", () => {
    expect(() =>
      contentEntryTransitionAuditRecord({
        actorId: "actor-1",
        createdAt: new Date(),
        id: "audit-1",
        metadata: { siteId: "another-site" },
      }),
    ).toThrow(InvalidContentEntryTransitionAuditError);
  });
});
