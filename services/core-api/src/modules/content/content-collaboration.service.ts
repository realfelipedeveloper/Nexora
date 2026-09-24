import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  contentEntryAssignmentCreateSchema,
  contentEntryCommentCreateSchema,
  contentEntryReviewCreateSchema,
  findContentEntryWorkflowTransition,
  type ContentEntryAssignmentCreateInput,
  type ContentEntryCommentCreateInput,
  type ContentEntryReviewCreateInput,
} from "@nexora/schemas";
import { InjectPrismaClient } from "../../database/database.module.js";
import { hasSitePermissions, type SiteAccess } from "../identity/site-permissions.js";
import {
  ContentEntryNotFoundError,
  ContentPreconditionFailedError,
  InvalidContentInputError,
  InvalidContentPageError,
} from "./content-admin.service.js";
import { ContentMetrics } from "./content-metrics.js";
import {
  contentEntryTransitionAuditAction,
  contentEntryTransitionAuditData,
  contentEntryTransitionAuditEntity,
  contentEntryTransitionAuditRecord,
} from "./content-transition-audit.js";

const defaultPageSize = 25;
const maximumPageSize = 100;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const userSelection = { displayName: true, id: true } as const;
const assignmentSelection = {
  assignedBy: { select: userSelection },
  assignee: { select: userSelection },
  createdAt: true,
  id: true,
} as const;
const commentSelection = {
  author: { select: userSelection },
  body: true,
  createdAt: true,
  id: true,
} as const;
const reviewSelection = {
  contentRevision: true,
  createdAt: true,
  decision: true,
  id: true,
  note: true,
  reviewer: { select: userSelection },
} as const;
const reviewEntrySelection = {
  id: true,
  publishedAt: true,
  revision: true,
  status: true,
  updatedAt: true,
} as const;
const transitionAuditSelection = {
  actorId: true,
  createdAt: true,
  id: true,
  metadata: true,
} as const;

export type CollaborationPageInput = {
  cursor?: string;
  limit?: string;
};

export class ContentEntryAssignmentNotFoundError extends Error {
  override readonly name = "ContentEntryAssignmentNotFoundError";

  constructor() {
    super("Content entry assignment was not found.");
  }
}

export class ContentEntryAssignmentConflictError extends Error {
  override readonly name = "ContentEntryAssignmentConflictError";

  constructor() {
    super("This user is already assigned to the content entry.");
  }
}

export class ContentEntryAssigneeUnavailableError extends Error {
  override readonly name = "ContentEntryAssigneeUnavailableError";

  constructor() {
    super("The requested assignee is not available for this site.");
  }
}

export class ContentEntryReviewConflictError extends Error {
  override readonly name = "ContentEntryReviewConflictError";

  constructor() {
    super("This review decision was already recorded for the content revision.");
  }
}

export class ContentEntryReviewForbiddenError extends Error {
  override readonly name = "ContentEntryReviewForbiddenError";

  constructor() {
    super("Editorial review is not permitted for this site access.");
  }
}

export class ContentEntryReviewStateConflictError extends Error {
  override readonly name = "ContentEntryReviewStateConflictError";

  constructor() {
    super("Only content in review can receive an editorial decision.");
  }
}

function isPrismaError(error: unknown, code: string) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

function parsePage(input: CollaborationPageInput) {
  const rawLimit = input.limit ?? String(defaultPageSize);
  if (!/^[1-9][0-9]{0,2}$/u.test(rawLimit)) {
    throw new InvalidContentPageError();
  }
  const limit = Number(rawLimit);
  if (limit > maximumPageSize || (input.cursor && !uuidPattern.test(input.cursor))) {
    throw new InvalidContentPageError();
  }
  return { cursor: input.cursor, limit };
}

function parseAssignment(input: unknown): ContentEntryAssignmentCreateInput {
  const result = contentEntryAssignmentCreateSchema.safeParse(input);
  if (!result.success) {
    throw new InvalidContentInputError();
  }
  return result.data;
}

function parseComment(input: unknown): ContentEntryCommentCreateInput {
  const result = contentEntryCommentCreateSchema.safeParse(input);
  if (!result.success) {
    throw new InvalidContentInputError();
  }
  return result.data;
}

function parseReview(input: unknown): ContentEntryReviewCreateInput {
  const result = contentEntryReviewCreateSchema.safeParse(input);
  if (!result.success) {
    throw new InvalidContentInputError();
  }
  return result.data;
}

@Injectable()
export class ContentCollaborationService {
  constructor(
    @InjectPrismaClient() private readonly prisma: PrismaClient,
    @Inject(ContentMetrics) private readonly metrics: ContentMetrics,
  ) {}

  async listTransitions(siteId: string, contentEntryId: string, input: CollaborationPageInput) {
    const page = parsePage(input);
    await this.requireEntry(this.prisma, siteId, contentEntryId);
    const where: Prisma.AuditEventWhereInput = {
      action: contentEntryTransitionAuditAction,
      entity: contentEntryTransitionAuditEntity,
      entityId: contentEntryId,
      metadata: { path: ["siteId"], equals: siteId },
    };
    if (page.cursor) {
      const cursor = await this.prisma.auditEvent.findFirst({
        select: { id: true },
        where: { ...where, id: page.cursor },
      });
      if (!cursor) {
        throw new InvalidContentPageError();
      }
    }

    const records = await this.prisma.auditEvent.findMany({
      cursor: page.cursor ? { id: page.cursor } : undefined,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: transitionAuditSelection,
      skip: page.cursor ? 1 : 0,
      take: page.limit + 1,
      where,
    });
    return this.page(records.map(contentEntryTransitionAuditRecord), page.limit);
  }

  async listAssignments(siteId: string, contentEntryId: string, input: CollaborationPageInput) {
    const page = parsePage(input);
    await this.requireEntry(this.prisma, siteId, contentEntryId);
    if (page.cursor) {
      const cursor = await this.prisma.contentEntryAssignment.findFirst({
        select: { id: true },
        where: { contentEntryId, id: page.cursor, siteId },
      });
      if (!cursor) {
        throw new InvalidContentPageError();
      }
    }

    const records = await this.prisma.contentEntryAssignment.findMany({
      cursor: page.cursor ? { id: page.cursor } : undefined,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: assignmentSelection,
      skip: page.cursor ? 1 : 0,
      take: page.limit + 1,
      where: { contentEntryId, siteId },
    });
    return this.page(records, page.limit);
  }

  async createAssignment(actorId: string, siteId: string, contentEntryId: string, input: unknown) {
    const command = parseAssignment(input);

    try {
      const assignment = await this.prisma.$transaction(async (transaction) => {
        await this.requireEntry(transaction, siteId, contentEntryId);
        const assignee = await transaction.user.findFirst({
          select: { id: true },
          where: {
            id: command.assigneeId,
            OR: [
              { isSystemAdmin: true },
              {
                siteRoleAssignments: {
                  some: {
                    role: { permissions: { some: { permissionKey: "content.write" } } },
                    siteId,
                  },
                },
              },
            ],
            status: "ACTIVE",
          },
        });
        if (!assignee) {
          throw new ContentEntryAssigneeUnavailableError();
        }
        const created = await transaction.contentEntryAssignment.create({
          data: {
            assignedById: actorId,
            assigneeId: assignee.id,
            contentEntryId,
            siteId,
          },
          select: assignmentSelection,
        });
        await transaction.auditEvent.create({
          data: {
            action: "content.entry.assignment.created",
            actorId,
            entity: "ContentEntryAssignment",
            entityId: created.id,
            metadata: { assigneeId: assignee.id, contentEntryId, siteId },
          },
        });
        return created;
      });
      this.metrics.recordCollaborationMutation("assignment_created");
      return assignment;
    } catch (error) {
      if (isPrismaError(error, "P2002")) {
        throw new ContentEntryAssignmentConflictError();
      }
      throw error;
    }
  }

  async deleteAssignment(
    actorId: string,
    siteId: string,
    contentEntryId: string,
    assignmentId: string,
  ) {
    await this.prisma.$transaction(async (transaction) => {
      await this.requireEntry(transaction, siteId, contentEntryId);
      const assignment = await transaction.contentEntryAssignment.findFirst({
        select: { assigneeId: true, id: true },
        where: { contentEntryId, id: assignmentId, siteId },
      });
      if (!assignment) {
        throw new ContentEntryAssignmentNotFoundError();
      }
      const deleted = await transaction.contentEntryAssignment.deleteMany({
        where: { contentEntryId, id: assignmentId, siteId },
      });
      if (deleted.count !== 1) {
        throw new ContentEntryAssignmentNotFoundError();
      }
      await transaction.auditEvent.create({
        data: {
          action: "content.entry.assignment.deleted",
          actorId,
          entity: "ContentEntryAssignment",
          entityId: assignmentId,
          metadata: { assigneeId: assignment.assigneeId, contentEntryId, siteId },
        },
      });
    });
    this.metrics.recordCollaborationMutation("assignment_deleted");
  }

  async listComments(siteId: string, contentEntryId: string, input: CollaborationPageInput) {
    const page = parsePage(input);
    await this.requireEntry(this.prisma, siteId, contentEntryId);
    if (page.cursor) {
      const cursor = await this.prisma.contentEntryComment.findFirst({
        select: { id: true },
        where: { contentEntryId, id: page.cursor, siteId },
      });
      if (!cursor) {
        throw new InvalidContentPageError();
      }
    }

    const records = await this.prisma.contentEntryComment.findMany({
      cursor: page.cursor ? { id: page.cursor } : undefined,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: commentSelection,
      skip: page.cursor ? 1 : 0,
      take: page.limit + 1,
      where: { contentEntryId, siteId },
    });
    return this.page(records, page.limit);
  }

  async createComment(actorId: string, siteId: string, contentEntryId: string, input: unknown) {
    const command = parseComment(input);
    const comment = await this.prisma.$transaction(async (transaction) => {
      await this.requireEntry(transaction, siteId, contentEntryId);
      const created = await transaction.contentEntryComment.create({
        data: { authorId: actorId, body: command.body, contentEntryId, siteId },
        select: commentSelection,
      });
      await transaction.auditEvent.create({
        data: {
          action: "content.entry.comment.created",
          actorId,
          entity: "ContentEntryComment",
          entityId: created.id,
          metadata: { contentEntryId, siteId },
        },
      });
      return created;
    });
    this.metrics.recordCollaborationMutation("comment_created");
    return comment;
  }

  async listReviews(siteId: string, contentEntryId: string, input: CollaborationPageInput) {
    const page = parsePage(input);
    await this.requireEntry(this.prisma, siteId, contentEntryId);
    if (page.cursor) {
      const cursor = await this.prisma.contentEntryReview.findFirst({
        select: { id: true },
        where: { contentEntryId, id: page.cursor, siteId },
      });
      if (!cursor) {
        throw new InvalidContentPageError();
      }
    }

    const records = await this.prisma.contentEntryReview.findMany({
      cursor: page.cursor ? { id: page.cursor } : undefined,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: reviewSelection,
      skip: page.cursor ? 1 : 0,
      take: page.limit + 1,
      where: { contentEntryId, siteId },
    });
    return this.page(records, page.limit);
  }

  async createReview(
    actorId: string,
    siteId: string,
    access: SiteAccess,
    contentEntryId: string,
    expectedRevision: number,
    input: unknown,
  ) {
    const command = parseReview(input);
    if (access.siteId !== siteId || !hasSitePermissions(access, ["content.publish"])) {
      throw new ContentEntryReviewForbiddenError();
    }

    try {
      const result = await this.prisma.$transaction(async (transaction) => {
        const current = await transaction.contentEntry.findUnique({
          select: { id: true, revision: true, status: true },
          where: { id_siteId: { id: contentEntryId, siteId } },
        });
        if (!current) {
          throw new ContentEntryNotFoundError();
        }
        if (current.revision !== expectedRevision) {
          this.preconditionFailed();
        }
        if (current.status !== "IN_REVIEW") {
          throw new ContentEntryReviewStateConflictError();
        }

        const changed = await transaction.contentEntry.updateMany({
          data:
            command.decision === "CHANGES_REQUESTED"
              ? { publishedAt: null, revision: { increment: 1 }, status: "DRAFT" }
              : { updatedAt: new Date() },
          where: {
            id: contentEntryId,
            revision: expectedRevision,
            siteId,
            status: "IN_REVIEW",
          },
        });
        if (changed.count !== 1) {
          this.preconditionFailed();
        }

        const review = await transaction.contentEntryReview.create({
          data: {
            contentEntryId,
            contentRevision: expectedRevision,
            decision: command.decision,
            note: command.note,
            reviewerId: actorId,
            siteId,
          },
          select: reviewSelection,
        });
        const entry = await transaction.contentEntry.findUniqueOrThrow({
          select: reviewEntrySelection,
          where: { id_siteId: { id: contentEntryId, siteId } },
        });
        await transaction.auditEvent.create({
          data: {
            action: "content.entry.review.created",
            actorId,
            entity: "ContentEntryReview",
            entityId: review.id,
            metadata: {
              contentEntryId,
              contentRevision: expectedRevision,
              decision: command.decision,
              resultingRevision: entry.revision,
              siteId,
            },
          },
        });
        if (command.decision === "CHANGES_REQUESTED") {
          const transition = findContentEntryWorkflowTransition("IN_REVIEW", "DRAFT");
          if (!transition) {
            throw new ContentEntryReviewStateConflictError();
          }
          await transaction.auditEvent.create({
            data: contentEntryTransitionAuditData({
              actorId,
              contentEntryId,
              previousRevision: expectedRevision,
              revision: entry.revision,
              siteId,
              transition,
            }),
          });
        }
        return { entry, review };
      });
      this.metrics.recordReviewDecision(command.decision);
      if (command.decision === "CHANGES_REQUESTED") {
        this.metrics.recordStateTransition("IN_REVIEW", "DRAFT");
      }
      return result;
    } catch (error) {
      if (isPrismaError(error, "P2002")) {
        throw new ContentEntryReviewConflictError();
      }
      throw error;
    }
  }

  private async requireEntry(
    client: Pick<PrismaClient, "contentEntry"> | Prisma.TransactionClient,
    siteId: string,
    contentEntryId: string,
  ) {
    const entry = await client.contentEntry.findUnique({
      select: { id: true },
      where: { id_siteId: { id: contentEntryId, siteId } },
    });
    if (!entry) {
      throw new ContentEntryNotFoundError();
    }
  }

  private page<Record extends { id: string }>(records: Record[], limit: number) {
    const hasNextPage = records.length > limit;
    const items = hasNextPage ? records.slice(0, limit) : records;
    return { items, nextCursor: hasNextPage ? items.at(-1)?.id : undefined };
  }

  private preconditionFailed(): never {
    this.metrics.recordPreconditionFailure();
    throw new ContentPreconditionFailedError();
  }
}
