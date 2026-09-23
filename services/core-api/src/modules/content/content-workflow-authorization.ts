import {
  findContentEntryWorkflowTransition,
  type ContentEntryStatus,
  type ContentEntryWorkflowTransition,
} from "@nexora/schemas";
import {
  hasSitePermissions,
  type SiteAccess,
  type SitePermission,
} from "../identity/site-permissions.js";

type ContentEntryWorkflowAction = ContentEntryWorkflowTransition["action"];

export const contentWorkflowTransitionPermissions = Object.freeze({
  ARCHIVE: "content.publish",
  PUBLISH: "content.publish",
  RESTORE: "content.publish",
  RETURN_TO_DRAFT: "content.write",
  SUBMIT_FOR_REVIEW: "content.write",
  UNPUBLISH: "content.publish",
} satisfies Record<ContentEntryWorkflowAction, SitePermission>);

const stableStatePermissions = Object.freeze({
  ARCHIVED: "content.publish",
  DRAFT: "content.write",
  IN_REVIEW: "content.write",
  PUBLISHED: "content.publish",
} satisfies Record<ContentEntryStatus, SitePermission>);

export function requiredContentWorkflowPermission(
  from: ContentEntryStatus,
  to: ContentEntryStatus,
): SitePermission | undefined {
  if (from === to) {
    return stableStatePermissions[to];
  }

  const transition = findContentEntryWorkflowTransition(from, to);
  return transition ? contentWorkflowTransitionPermissions[transition.action] : undefined;
}

export function canSetContentWorkflowState(
  access: SiteAccess,
  siteId: string,
  from: ContentEntryStatus,
  to: ContentEntryStatus,
) {
  const requiredPermission = requiredContentWorkflowPermission(from, to);
  return (
    access.siteId === siteId &&
    requiredPermission !== undefined &&
    hasSitePermissions(access, [requiredPermission])
  );
}
