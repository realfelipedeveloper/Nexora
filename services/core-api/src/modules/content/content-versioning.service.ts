import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { contentEntrySnapshotLocalesSchema, type ContentEntryStatus } from "@nexora/schemas";
import { InjectPrismaClient } from "../../database/database.module.js";
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

export class InvalidContentRevisionComparisonError extends Error {
  override readonly name = "InvalidContentRevisionComparisonError";

  constructor() {
    super("Content revision comparison parameters are invalid.");
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
}
