import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { ContentMetrics } from "./content-metrics.js";
import {
  InvalidPublicationScheduleError,
  PublicationScheduleConflictError,
  PublicationScheduleNotFoundError,
  PublicationSchedulerService,
} from "./publication-scheduler.service.js";

function delegate() {
  return {
    create: vi.fn(),
    deleteMany: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    upsert: vi.fn(),
  };
}

function fixture() {
  const transaction = {
    auditEvent: delegate(),
    contentEntry: delegate(),
    contentEntryReview: delegate(),
    contentEntrySnapshot: delegate(),
    domainEvent: delegate(),
    publicationSchedule: delegate(),
    publishedContentEntry: delegate(),
  };
  const client = {
    $transaction: vi.fn(async (callback: (client: typeof transaction) => unknown) =>
      callback(transaction),
    ),
    contentEntry: delegate(),
    publicationSchedule: delegate(),
  };
  const metrics = { recordPublicationOperation: vi.fn() } as unknown as ContentMetrics;
  return {
    client,
    metrics,
    service: new PublicationSchedulerService(client as unknown as PrismaClient, metrics),
    transaction,
  };
}

const commandId = "a11f740b-f15f-4279-8ca2-3877a4cae775";
const scheduledFor = "2026-09-26T18:00:00.000Z";

describe("publication scheduler service", () => {
  it("creates an auditable schedule and returns the same command idempotently", async () => {
    const { client, metrics, service, transaction } = fixture();
    client.publicationSchedule.findUnique.mockResolvedValueOnce(null);
    transaction.contentEntry.findUnique.mockResolvedValue({ id: "entry-1", status: "IN_REVIEW" });
    transaction.publicationSchedule.create.mockResolvedValue({
      action: "PUBLISH",
      commandId,
      id: "schedule-1",
      scheduledFor: new Date(scheduledFor),
    });
    const command = { action: "PUBLISH", commandId, scheduledFor };
    await expect(service.create("actor-1", "site-1", "entry-1", command)).resolves.toMatchObject({
      id: "schedule-1",
    });
    expect(transaction.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(transaction.domainEvent.create).toHaveBeenCalledTimes(1);
    expect(metrics.recordPublicationOperation).toHaveBeenCalledWith("scheduled");

    client.publicationSchedule.findUnique.mockResolvedValue({
      action: "PUBLISH",
      commandId,
      contentEntryId: "entry-1",
      id: "schedule-1",
      scheduledFor: new Date(scheduledFor),
      siteId: "site-1",
    });
    await expect(service.create("actor-1", "site-1", "entry-1", command)).resolves.toMatchObject({
      id: "schedule-1",
    });
    expect(client.$transaction).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed, mismatched, and unschedulable commands", async () => {
    const { client, service, transaction } = fixture();
    await expect(service.create("actor", "site", "entry", {})).rejects.toBeInstanceOf(
      InvalidPublicationScheduleError,
    );
    client.publicationSchedule.findUnique.mockResolvedValue({
      action: "UNPUBLISH",
      commandId,
      contentEntryId: "other",
      scheduledFor: new Date(scheduledFor),
      siteId: "site-1",
    });
    await expect(
      service.create("actor", "site-1", "entry-1", {
        action: "PUBLISH",
        commandId,
        scheduledFor,
      }),
    ).rejects.toBeInstanceOf(PublicationScheduleConflictError);
    client.publicationSchedule.findUnique.mockResolvedValue(null);
    transaction.contentEntry.findUnique.mockResolvedValue({ id: "entry-1", status: "DRAFT" });
    await expect(
      service.create("actor", "site-1", "entry-1", {
        action: "PUBLISH",
        commandId,
        scheduledFor,
      }),
    ).rejects.toBeInstanceOf(PublicationScheduleConflictError);
  });

  it("lists schedules with bounded cursor pagination", async () => {
    const { client, service } = fixture();
    client.contentEntry.findUnique.mockResolvedValue({ id: "entry-1", status: "DRAFT" });
    client.publicationSchedule.findFirst.mockResolvedValue({ id: commandId });
    client.publicationSchedule.findMany.mockResolvedValue([{ id: "one" }, { id: "two" }]);
    await expect(
      service.list("site-1", "entry-1", { cursor: commandId, limit: "1" }),
    ).resolves.toEqual({ items: [{ id: "one" }], nextCursor: "one" });
    await expect(service.list("site-1", "entry-1", { limit: "101" })).rejects.toBeInstanceOf(
      InvalidPublicationScheduleError,
    );
  });

  it("cancels only pending scoped schedules", async () => {
    const { metrics, service, transaction } = fixture();
    transaction.publicationSchedule.updateMany.mockResolvedValueOnce({ count: 1 });
    await expect(service.cancel("actor", "site", "entry", "schedule")).resolves.toBeUndefined();
    expect(metrics.recordPublicationOperation).toHaveBeenCalledWith("cancelled");
    transaction.publicationSchedule.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.cancel("actor", "site", "entry", "missing")).rejects.toBeInstanceOf(
      PublicationScheduleNotFoundError,
    );
  });

  it("claims each due schedule once and records failed executions", async () => {
    const { client, metrics, service, transaction } = fixture();
    client.publicationSchedule.findMany.mockResolvedValue([{ id: "schedule-1" }]);
    client.publicationSchedule.updateMany.mockResolvedValue({ count: 1 });
    transaction.publicationSchedule.findUniqueOrThrow.mockResolvedValue({
      action: "PUBLISH",
      contentEntryId: "entry-1",
      id: "schedule-1",
      requestedById: "actor-1",
      siteId: "site-1",
    });
    transaction.contentEntry.findUnique.mockResolvedValue({
      publishedAt: null,
      revision: 1,
      status: "DRAFT",
    });
    await expect(service.processDue(new Date("2026-09-27T00:00:00.000Z"))).resolves.toEqual({
      claimed: 0,
      failed: 1,
    });
    expect(client.publicationSchedule.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) }),
    );
    expect(metrics.recordPublicationOperation).toHaveBeenCalledWith("schedule_failed");
  });

  it("does not execute a schedule claimed by another process", async () => {
    const { client, service } = fixture();
    client.publicationSchedule.findMany.mockResolvedValue([{ id: "schedule-1" }]);
    client.publicationSchedule.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.processDue()).resolves.toEqual({ claimed: 0, failed: 0 });
    expect(client.$transaction).not.toHaveBeenCalled();
  });
});
