import {
  contentEntryTransitionAuditMetadataSchema,
  type ContentEntryTransitionAuditMetadata,
  type ContentEntryWorkflowTransition,
} from "@nexora/schemas";

export const contentEntryTransitionAuditAction = "content.entry.status.changed";
export const contentEntryTransitionAuditEntity = "ContentEntry";

type TransitionAuditInput = {
  actorId: string;
  contentEntryId: string;
  previousRevision: number;
  revision: number;
  siteId: string;
  transition: ContentEntryWorkflowTransition;
};

type StoredTransitionAudit = {
  actorId: string | null;
  createdAt: Date;
  id: string;
  metadata: unknown;
};

export class InvalidContentEntryTransitionAuditError extends Error {
  override readonly name = "InvalidContentEntryTransitionAuditError";

  constructor() {
    super("Stored content transition audit metadata is invalid.");
  }
}

export function contentEntryTransitionAuditData(input: TransitionAuditInput) {
  const metadata: ContentEntryTransitionAuditMetadata = {
    from: input.transition.from,
    previousRevision: input.previousRevision,
    revision: input.revision,
    siteId: input.siteId,
    to: input.transition.to,
    transition: input.transition.action,
  };
  return {
    action: contentEntryTransitionAuditAction,
    actorId: input.actorId,
    entity: contentEntryTransitionAuditEntity,
    entityId: input.contentEntryId,
    metadata,
  };
}

export function contentEntryTransitionAuditRecord(record: StoredTransitionAudit) {
  const parsed = contentEntryTransitionAuditMetadataSchema.safeParse(record.metadata);
  if (!parsed.success) {
    throw new InvalidContentEntryTransitionAuditError();
  }
  return {
    actorId: record.actorId,
    createdAt: record.createdAt,
    id: record.id,
    ...parsed.data,
  };
}
