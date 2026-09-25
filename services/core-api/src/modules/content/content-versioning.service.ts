import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import { contentEntrySnapshotLocalesSchema, type ContentEntryStatus } from "@nexora/schemas";
import { InjectPrismaClient } from "../../database/database.module.js";
import {
  ContentEntryNotFoundError,
  ContentPreconditionFailedError,
} from "./content-admin.service.js";
import { createContentEntrySnapshot } from "./content-entry-snapshot.js";
import { generateContentEntryFieldDiff } from "./content-entry-diff.js";
import { ContentMetrics } from "./content-metrics.js";

const maximumDatabaseInteger = 2_147_483_647;
const positiveIntegerPattern = /^[1-9][0-9]*$/u;

type ContentRevisionComparisonInput = {
  from?: string;
  to?: string;
};

const revisionSnapshotSelection = {
  actorId: true,
  contentTypeId: true,
  createdAt: true,
  locales: true,
  publishedAt: true,
  revision: true,
  schemaVersion: true,
  status: true,
} as const;

const restoredContentEntrySelection = {
  contentLocales: {
    orderBy: { localeId: "asc" },
    select: {
      createdAt: true,
      data: true,
      id: true,
      locale: { select: { code: true } },
      localeId: true,
      revision: true,
      schemaVersion: true,
      updatedAt: true,
    },
  },
  contentType: { select: { displayName: true, id: true, key: true } },
  contentTypeId: true,
  createdAt: true,
  id: true,
  publishedAt: true,
  revision: true,
  schemaVersion: true,
  status: true,
  updatedAt: true,
} as const;

export class InvalidContentRevisionComparisonError extends Error {
  override readonly name = "InvalidContentRevisionComparisonError";

  constructor() {
    super("Content revision comparison parameters are invalid.");
  }
}

export class InvalidContentRevisionError extends Error {
  override readonly name = "InvalidContentRevisionError";

  constructor() {
    super("Content revision is invalid.");
  }
}

export class ContentEntryRevisionNotFoundError extends Error {
  override readonly name = "ContentEntryRevisionNotFoundError";

  constructor() {
    super("Content entry revision was not found.");
  }
}

function parseRevision(value: string | undefined) {
  if (!value || !positiveIntegerPattern.test(value)) {
    return undefined;
  }
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision > maximumDatabaseInteger) {
    return undefined;
  }
  return revision;
}

function parseComparison(input: ContentRevisionComparisonInput) {
  const from = parseRevision(input.from);
  const to = parseRevision(input.to);
  return from === undefined || to === undefined ? undefined : { from, to };
}

function revisionMetadata(snapshot: {
  actorId: string | null;
  createdAt: Date;
  publishedAt: Date | null;
  revision: number;
  schemaVersion: number;
  status: ContentEntryStatus;
}) {
  return {
    actorId: snapshot.actorId,
    createdAt: snapshot.createdAt,
    publishedAt: snapshot.publishedAt,
    revision: snapshot.revision,
    schemaVersion: snapshot.schemaVersion,
    status: snapshot.status,
  };
}

@Injectable()
export class ContentVersioningService {
  constructor(
    @InjectPrismaClient() private readonly prisma: PrismaClient,
    @Inject(ContentMetrics) private readonly metrics: ContentMetrics,
  ) {}

  async listRevisions(siteId: string, contentEntryId: string) {
    const entry = await this.prisma.contentEntry.findUnique({
      select: { id: true },
      where: { id_siteId: { id: contentEntryId, siteId } },
    });
    if (!entry) {
      throw new ContentEntryNotFoundError();
    }

    return this.prisma.contentEntrySnapshot.findMany({
      orderBy: { revision: "desc" },
      select: {
        actorId: true,
        createdAt: true,
        publishedAt: true,
        revision: true,
        schemaVersion: true,
        status: true,
      },
      take: 100,
      where: { contentEntryId, siteId },
    });
  }

  async compareRevisions(
    siteId: string,
    contentEntryId: string,
    input: ContentRevisionComparisonInput,
  ) {
    const comparison = parseComparison(input);
    if (!comparison) {
      this.metrics.recordRevisionComparison("invalid");
      throw new InvalidContentRevisionComparisonError();
    }
    const snapshots = await this.prisma.contentEntrySnapshot.findMany({
      select: revisionSnapshotSelection,
      where: {
        contentEntryId,
        revision: { in: [...new Set([comparison.from, comparison.to])] },
        siteId,
      },
    });
    const snapshotsByRevision = new Map(snapshots.map((snapshot) => [snapshot.revision, snapshot]));
    const fromSnapshot = snapshotsByRevision.get(comparison.from);
    const toSnapshot = snapshotsByRevision.get(comparison.to);
    if (!fromSnapshot || !toSnapshot) {
      this.metrics.recordRevisionComparison("not_found");
      throw new ContentEntryRevisionNotFoundError();
    }

    const fromLocales = contentEntrySnapshotLocalesSchema.parse(fromSnapshot.locales);
    const toLocales = contentEntrySnapshotLocalesSchema.parse(toSnapshot.locales);
    const result = {
      contentEntryId,
      contentTypeId: toSnapshot.contentTypeId,
      fieldChanges: generateContentEntryFieldDiff(fromLocales, toLocales),
      from: revisionMetadata(fromSnapshot),
      to: revisionMetadata(toSnapshot),
    };
    this.metrics.recordRevisionComparison("success");
    return result;
  }

  async restoreRevision(
    actorId: string,
    siteId: string,
    contentEntryId: string,
    revisionInput: string,
    expectedRevision: number,
  ) {
    const restoredFromRevision = parseRevision(revisionInput);
    if (restoredFromRevision === undefined) {
      this.metrics.recordRevisionRestoration("invalid");
      throw new InvalidContentRevisionError();
    }

    const restored = await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.contentEntry.findUnique({
        select: { id: true, revision: true },
        where: { id_siteId: { id: contentEntryId, siteId } },
      });
      if (!current) {
        this.metrics.recordRevisionRestoration("not_found");
        throw new ContentEntryNotFoundError();
      }
      if (current.revision !== expectedRevision) {
        this.preconditionFailed();
      }

      const snapshot = await transaction.contentEntrySnapshot.findUnique({
        select: revisionSnapshotSelection,
        where: {
          contentEntryId_siteId_revision: {
            contentEntryId,
            revision: restoredFromRevision,
            siteId,
          },
        },
      });
      if (!snapshot) {
        this.metrics.recordRevisionRestoration("not_found");
        throw new ContentEntryRevisionNotFoundError();
      }
      const locales = contentEntrySnapshotLocalesSchema.parse(snapshot.locales);
      const revision = expectedRevision + 1;
      const claimed = await transaction.contentEntry.updateMany({
        data: {
          publishedAt: null,
          revision,
          schemaVersion: snapshot.schemaVersion,
          status: "DRAFT",
        },
        where: { id: contentEntryId, revision: expectedRevision, siteId },
      });
      if (claimed.count !== 1) {
        this.preconditionFailed();
      }

      await transaction.contentLocale.deleteMany({ where: { contentEntryId, siteId } });
      await transaction.contentLocale.createMany({
        data: locales.map((locale) => ({
          contentEntryId,
          data: locale.data as Prisma.InputJsonValue,
          localeId: locale.localeId,
          schemaVersion: locale.schemaVersion,
          siteId,
        })),
      });
      const entry = await transaction.contentEntry.findUniqueOrThrow({
        select: restoredContentEntrySelection,
        where: { id_siteId: { id: contentEntryId, siteId } },
      });
      await createContentEntrySnapshot(transaction, actorId, siteId, contentEntryId);
      await transaction.auditEvent.create({
        data: {
          action: "content.entry.revision.restored",
          actorId,
          entity: "ContentEntry",
          entityId: contentEntryId,
          metadata: {
            previousRevision: expectedRevision,
            restoredFromRevision,
            revision,
            schemaVersion: snapshot.schemaVersion,
            siteId,
          },
        },
      });
      return entry;
    });
    this.metrics.recordRevisionRestoration("success");
    return restored;
  }

  private preconditionFailed(): never {
    this.metrics.recordPreconditionFailure();
    this.metrics.recordRevisionRestoration("precondition_failed");
    throw new ContentPreconditionFailedError();
  }
}
