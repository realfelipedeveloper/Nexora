import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  contentEntryAssignmentCreateSchema,
  contentEntryCommentCreateSchema,
  type ContentEntryAssignmentCreateInput,
  type ContentEntryCommentCreateInput,
} from "@nexora/schemas";
import { InjectPrismaClient } from "../../database/database.module.js";
import {
  ContentEntryNotFoundError,
  InvalidContentInputError,
  InvalidContentPageError,
} from "./content-admin.service.js";
import { ContentMetrics } from "./content-metrics.js";

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

@Injectable()
export class ContentCollaborationService {
  constructor(
    @InjectPrismaClient() private readonly prisma: PrismaClient,
    @Inject(ContentMetrics) private readonly metrics: ContentMetrics,
  ) {}

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
}
