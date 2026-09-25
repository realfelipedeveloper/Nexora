import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Prisma, type PrismaClient, type PublicationAction } from "@prisma/client";
import {
  publicationScheduleCreateSchema,
  type PublicationScheduleCreateInput,
} from "@nexora/schemas";
import { InjectPrismaClient } from "../../database/database.module.js";
import { createContentEntrySnapshot } from "./content-entry-snapshot.js";
import { ContentMetrics } from "./content-metrics.js";
import { contentEntryTransitionAuditData } from "./content-transition-audit.js";
import {
  createPublicationEvent,
  removePublishedProjection,
  replacePublishedProjection,
} from "./publication-projection.js";

const maximumPageSize = 100;
const defaultPageSize = 25;
const maximumScheduleHorizonMs = 10 * 365 * 24 * 60 * 60 * 1_000;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const scheduleSelection = {
  action: true,
  commandId: true,
  completedAt: true,
  createdAt: true,
  failureCode: true,
  id: true,
  scheduledFor: true,
  status: true,
  updatedAt: true,
} as const;

export class InvalidPublicationScheduleError extends Error {
  override readonly name = "InvalidPublicationScheduleError";
  constructor() {
    super("Publication schedule input is invalid.");
  }
}

export class PublicationScheduleConflictError extends Error {
  override readonly name = "PublicationScheduleConflictError";
  constructor() {
    super("Publication schedule conflicts with the current entry state.");
  }
}

export class PublicationScheduleNotFoundError extends Error {
  override readonly name = "PublicationScheduleNotFoundError";
  constructor() {
    super("Publication schedule was not found.");
  }
}

function parseSchedule(input: unknown): PublicationScheduleCreateInput {
  const result = publicationScheduleCreateSchema.safeParse(input);
  if (!result.success) throw new InvalidPublicationScheduleError();
  const now = Date.now();
  if (result.data.scheduledFor.getTime() > now + maximumScheduleHorizonMs) {
    throw new InvalidPublicationScheduleError();
  }
  return result.data;
}

function parsePage(input: { cursor?: string; limit?: string }) {
  const rawLimit = input.limit ?? String(defaultPageSize);
  if (!/^[1-9][0-9]{0,2}$/u.test(rawLimit)) throw new InvalidPublicationScheduleError();
  const limit = Number(rawLimit);
  if (limit > maximumPageSize || (input.cursor && !uuidPattern.test(input.cursor))) {
    throw new InvalidPublicationScheduleError();
  }
  return { cursor: input.cursor, limit };
}

function isConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

@Injectable()
export class PublicationSchedulerService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    @InjectPrismaClient() private readonly prisma: PrismaClient,
    @Inject(ContentMetrics) private readonly metrics: ContentMetrics,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === "test") return;
    const configured = Number(process.env.PUBLICATION_SCHEDULER_INTERVAL_MS ?? 30_000);
    const interval = Number.isFinite(configured)
      ? Math.min(Math.max(configured, 5_000), 300_000)
      : 30_000;
    this.timer = setInterval(() => void this.processDue().catch(() => undefined), interval);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async list(siteId: string, contentEntryId: string, input: { cursor?: string; limit?: string }) {
    const page = parsePage(input);
    await this.requireEntry(this.prisma, siteId, contentEntryId);
    if (page.cursor) {
      const cursor = await this.prisma.publicationSchedule.findFirst({
        select: { id: true },
        where: { contentEntryId, id: page.cursor, siteId },
      });
      if (!cursor) throw new InvalidPublicationScheduleError();
    }
    const records = await this.prisma.publicationSchedule.findMany({
      cursor: page.cursor ? { id: page.cursor } : undefined,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: scheduleSelection,
      skip: page.cursor ? 1 : 0,
      take: page.limit + 1,
      where: { contentEntryId, siteId },
    });
    const hasNextPage = records.length > page.limit;
    const items = hasNextPage ? records.slice(0, page.limit) : records;
    return { items, nextCursor: hasNextPage ? items.at(-1)?.id : undefined };
  }

  async create(actorId: string, siteId: string, contentEntryId: string, input: unknown) {
    const command = parseSchedule(input);
    const existing = await this.prisma.publicationSchedule.findUnique({
      select: { ...scheduleSelection, contentEntryId: true, siteId: true },
      where: { commandId: command.commandId },
    });
    if (existing) {
      if (
        existing.siteId === siteId &&
        existing.contentEntryId === contentEntryId &&
        existing.action === command.action &&
        existing.scheduledFor.getTime() === command.scheduledFor.getTime()
      )
        return existing;
      throw new PublicationScheduleConflictError();
    }

    try {
      const schedule = await this.prisma.$transaction(async (transaction) => {
        const entry = await this.requireEntry(transaction, siteId, contentEntryId);
        this.assertSchedulable(entry.status, command.action);
        const created = await transaction.publicationSchedule.create({
          data: { ...command, contentEntryId, requestedById: actorId, siteId },
          select: scheduleSelection,
        });
        await transaction.auditEvent.create({
          data: {
            action: "content.publication.scheduled",
            actorId,
            entity: "PublicationSchedule",
            entityId: created.id,
            metadata: {
              action: command.action,
              contentEntryId,
              scheduledFor: command.scheduledFor.toISOString(),
              siteId,
            },
          },
        });
        await transaction.domainEvent.create({
          data: {
            aggregateId: created.id,
            aggregateType: "PublicationSchedule",
            payload: {
              action: command.action,
              contentEntryId,
              scheduledFor: command.scheduledFor.toISOString(),
              siteId,
            },
            revision: 1,
            siteId,
            type: "content.publication.scheduled",
          },
        });
        return created;
      });
      this.metrics.recordPublicationOperation("scheduled");
      return schedule;
    } catch (error) {
      if (isConflict(error)) throw new PublicationScheduleConflictError();
      throw error;
    }
  }

  async cancel(actorId: string, siteId: string, contentEntryId: string, scheduleId: string) {
    await this.prisma.$transaction(async (transaction) => {
      const changed = await transaction.publicationSchedule.updateMany({
        data: { completedAt: new Date(), status: "CANCELLED" },
        where: { contentEntryId, id: scheduleId, siteId, status: "PENDING" },
      });
      if (changed.count !== 1) throw new PublicationScheduleNotFoundError();
      await transaction.auditEvent.create({
        data: {
          action: "content.publication.schedule.cancelled",
          actorId,
          entity: "PublicationSchedule",
          entityId: scheduleId,
          metadata: { contentEntryId, siteId },
        },
      });
      await transaction.domainEvent.create({
        data: {
          aggregateId: scheduleId,
          aggregateType: "PublicationSchedule",
          payload: { contentEntryId, siteId },
          revision: 2,
          siteId,
          type: "content.publication.schedule.cancelled",
        },
      });
    });
    this.metrics.recordPublicationOperation("cancelled");
  }

  async processDue(now = new Date(), limit = 25) {
    const staleBefore = new Date(now.getTime() - 5 * 60 * 1_000);
    await this.prisma.publicationSchedule.updateMany({
      data: { claimedAt: null, status: "PENDING" },
      where: { claimedAt: { lt: staleBefore }, completedAt: null, status: "PROCESSING" },
    });
    const due = await this.prisma.publicationSchedule.findMany({
      orderBy: [{ scheduledFor: "asc" }, { id: "asc" }],
      select: { id: true },
      take: Math.min(Math.max(limit, 1), 100),
      where: { scheduledFor: { lte: now }, status: "PENDING" },
    });
    const results = await Promise.allSettled(due.map(({ id }) => this.processOne(id, now)));
    return {
      claimed: results.filter((result) => result.status === "fulfilled" && result.value).length,
      failed: results.filter((result) => result.status === "rejected").length,
    };
  }

  private async processOne(scheduleId: string, now: Date) {
    const claimed = await this.prisma.publicationSchedule.updateMany({
      data: { claimedAt: now, status: "PROCESSING" },
      where: { id: scheduleId, scheduledFor: { lte: now }, status: "PENDING" },
    });
    if (claimed.count !== 1) return false;
    try {
      const action = await this.prisma.$transaction(async (transaction) => {
        const schedule = await transaction.publicationSchedule.findUniqueOrThrow({
          where: { id: scheduleId },
        });
        await this.executeAction(
          transaction,
          schedule.action,
          schedule.requestedById,
          schedule.siteId,
          schedule.contentEntryId,
          now,
        );
        await transaction.publicationSchedule.update({
          data: { completedAt: now, status: "COMPLETED" },
          where: { id: scheduleId },
        });
        return schedule.action;
      });
      this.metrics.recordPublicationOperation(
        action === "PUBLISH" ? "scheduled_published" : "scheduled_unpublished",
      );
      return true;
    } catch (error) {
      await this.prisma.publicationSchedule.updateMany({
        data: { completedAt: now, failureCode: "STATE_CONFLICT", status: "FAILED" },
        where: { id: scheduleId, status: "PROCESSING" },
      });
      this.metrics.recordPublicationOperation("schedule_failed");
      throw error;
    }
  }

  private async executeAction(
    transaction: Prisma.TransactionClient,
    action: PublicationAction,
    actorId: string | null,
    siteId: string,
    contentEntryId: string,
    now: Date,
  ) {
    const current = await transaction.contentEntry.findUnique({
      select: { publishedAt: true, revision: true, status: true },
      where: { id_siteId: { id: contentEntryId, siteId } },
    });
    if (!current) throw new PublicationScheduleConflictError();
    const target = action === "PUBLISH" ? "PUBLISHED" : "DRAFT";
    if (current.status === target) {
      if (target === "PUBLISHED" && current.publishedAt) {
        await replacePublishedProjection(
          transaction,
          siteId,
          contentEntryId,
          current.publishedAt,
          current.revision,
        );
      } else {
        await removePublishedProjection(transaction, siteId, contentEntryId);
      }
      return;
    }
    if (action === "PUBLISH") {
      if (current.status !== "IN_REVIEW") throw new PublicationScheduleConflictError();
      const approval = await transaction.contentEntryReview.findFirst({
        select: { id: true },
        where: { contentEntryId, contentRevision: current.revision, decision: "APPROVED", siteId },
      });
      if (!approval) throw new PublicationScheduleConflictError();
    } else if (current.status !== "PUBLISHED") {
      throw new PublicationScheduleConflictError();
    }
    const revision = current.revision + 1;
    const changed = await transaction.contentEntry.updateMany({
      data: { publishedAt: action === "PUBLISH" ? now : null, revision, status: target },
      where: { id: contentEntryId, revision: current.revision, siteId, status: current.status },
    });
    if (changed.count !== 1) throw new PublicationScheduleConflictError();
    if (action === "PUBLISH") {
      await replacePublishedProjection(transaction, siteId, contentEntryId, now, revision);
    } else {
      await removePublishedProjection(transaction, siteId, contentEntryId);
    }
    await createContentEntrySnapshot(transaction, actorId ?? "system", siteId, contentEntryId);
    const transition =
      action === "PUBLISH"
        ? ({ action: "PUBLISH", from: "IN_REVIEW", to: "PUBLISHED" } as const)
        : ({ action: "UNPUBLISH", from: "PUBLISHED", to: "DRAFT" } as const);
    await transaction.auditEvent.create({
      data: contentEntryTransitionAuditData({
        actorId: actorId ?? "system",
        contentEntryId,
        previousRevision: current.revision,
        revision,
        siteId,
        transition,
      }),
    });
    await createPublicationEvent(transaction, {
      contentEntryId,
      publishedAt: action === "PUBLISH" ? now : null,
      revision,
      siteId,
      type: action === "PUBLISH" ? "content.published" : "content.unpublished",
    });
  }

  private assertSchedulable(status: string, action: PublicationAction) {
    if (
      action === "PUBLISH"
        ? !["IN_REVIEW", "PUBLISHED"].includes(status)
        : !["PUBLISHED", "DRAFT"].includes(status)
    ) {
      throw new PublicationScheduleConflictError();
    }
  }

  private async requireEntry(
    client: PrismaClient | Prisma.TransactionClient,
    siteId: string,
    contentEntryId: string,
  ) {
    const entry = await client.contentEntry.findUnique({
      select: { id: true, status: true },
      where: { id_siteId: { id: contentEntryId, siteId } },
    });
    if (!entry) throw new PublicationScheduleNotFoundError();
    return entry;
  }
}
