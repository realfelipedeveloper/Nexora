import { describe, expect, it } from "vitest";
import type { SiteAccess, SitePermission } from "../identity/site-permissions.js";
import {
  canSetContentWorkflowState,
  contentWorkflowTransitionPermissions,
  requiredContentWorkflowPermission,
} from "./content-workflow-authorization.js";

const siteId = "site-1";

function access(roleKey: string, permissionKeys: SitePermission[]): SiteAccess {
  return { isSystemAdmin: false, permissionKeys, roleKeys: [roleKey], siteId };
}

describe("content workflow authorization", () => {
  it("assigns a site permission to every workflow action", () => {
    expect(contentWorkflowTransitionPermissions).toEqual({
      ARCHIVE: "content.publish",
      PUBLISH: "content.publish",
      RESTORE: "content.publish",
      RETURN_TO_DRAFT: "content.write",
      SUBMIT_FOR_REVIEW: "content.write",
      UNPUBLISH: "content.publish",
    });
    expect(requiredContentWorkflowPermission("DRAFT", "PUBLISHED")).toBeUndefined();
  });

  it("allows editors to submit and withdraw review but not publish", () => {
    const editor = access("editor", ["site.read", "content.read", "content.write"]);

    expect(canSetContentWorkflowState(editor, siteId, "DRAFT", "IN_REVIEW")).toBe(true);
    expect(canSetContentWorkflowState(editor, siteId, "IN_REVIEW", "DRAFT")).toBe(true);
    expect(canSetContentWorkflowState(editor, siteId, "IN_REVIEW", "PUBLISHED")).toBe(false);
    expect(canSetContentWorkflowState(editor, siteId, "PUBLISHED", "ARCHIVED")).toBe(false);
  });

  it("allows publishers and site administrators to execute every workflow transition", () => {
    for (const roleKey of ["publisher", "site-admin"]) {
      const privileged = access(roleKey, [
        "site.read",
        "content.read",
        "content.write",
        "content.publish",
      ]);

      expect(canSetContentWorkflowState(privileged, siteId, "DRAFT", "IN_REVIEW")).toBe(true);
      expect(canSetContentWorkflowState(privileged, siteId, "IN_REVIEW", "DRAFT")).toBe(true);
      expect(canSetContentWorkflowState(privileged, siteId, "IN_REVIEW", "PUBLISHED")).toBe(true);
      expect(canSetContentWorkflowState(privileged, siteId, "PUBLISHED", "DRAFT")).toBe(true);
      expect(canSetContentWorkflowState(privileged, siteId, "PUBLISHED", "ARCHIVED")).toBe(true);
      expect(canSetContentWorkflowState(privileged, siteId, "ARCHIVED", "DRAFT")).toBe(true);
    }
  });

  it("denies viewers, invalid transitions, and permissions from another site", () => {
    const viewer = access("viewer", ["site.read", "content.read"]);
    const publisher = access("publisher", ["content.write", "content.publish"]);

    expect(canSetContentWorkflowState(viewer, siteId, "DRAFT", "IN_REVIEW")).toBe(false);
    expect(canSetContentWorkflowState(publisher, siteId, "DRAFT", "PUBLISHED")).toBe(false);
    expect(canSetContentWorkflowState(publisher, "site-2", "IN_REVIEW", "PUBLISHED")).toBe(false);
  });

  it("authorizes idempotent requests according to the stable state", () => {
    const editor = access("editor", ["content.write"]);
    const publisher = access("publisher", ["content.publish"]);

    expect(canSetContentWorkflowState(editor, siteId, "DRAFT", "DRAFT")).toBe(true);
    expect(canSetContentWorkflowState(editor, siteId, "PUBLISHED", "PUBLISHED")).toBe(false);
    expect(canSetContentWorkflowState(publisher, siteId, "PUBLISHED", "PUBLISHED")).toBe(true);
  });
});
