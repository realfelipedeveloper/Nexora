import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContentMetrics } from "./content-metrics.js";
import {
  ContentPreviewNotFoundError,
  ContentPreviewService,
  InvalidContentPreviewRequestError,
  contentPreviewTtlMs,
} from "./content-preview.service.js";

const siteId = "10000000-0000-4000-8000-000000000001";
const entryId = "20000000-0000-4000-8000-000000000002";
const localeId = "30000000-0000-4000-8000-000000000003";
const assetId = "40000000-0000-4000-8000-000000000004";
const actorId = "50000000-0000-4000-8000-000000000005";
const now = new Date("2026-09-26T22:00:00.000Z");

const localeSnapshot = {
  data: {
    body: {
      content: [
        {
          attrs: { assetId, displayName: "Cover", kind: "image" },
          type: "asset",
        },
      ],
      schemaVersion: 1,
      type: "doc",
    },
    title: "Draft title",
  },
  localeCode: "pt-BR",
  localeId,
  schemaVersion: 2,
};

function fixture() {
  const transaction = {
    auditEvent: { create: vi.fn().mockResolvedValue({ id: "audit" }) },
    contentPreviewToken: {
      create: vi.fn().mockResolvedValue({ id: "preview-id" }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
  const prisma = {
    $transaction: vi.fn(async (operation: (client: typeof transaction) => unknown) =>
      operation(transaction),
    ),
    asset: { findUnique: vi.fn() },
    contentEntry: { findUnique: vi.fn() },
    contentEntrySnapshot: { findUnique: vi.fn() },
    contentPreviewToken: { findFirst: vi.fn() },
    publicationSchedule: { findFirst: vi.fn() },
  };
  return {
    metrics: new ContentMetrics(),
    prisma,
    service: new ContentPreviewService(prisma as never, new ContentMetrics()),
    transaction,
  };
}

describe("content preview configuration", () => {
  it("uses a five-minute default and enforces a short bounded lifetime", () => {
    expect(contentPreviewTtlMs(undefined)).toBe(300_000);
    expect(contentPreviewTtlMs("30")).toBe(30_000);
    expect(contentPreviewTtlMs("900")).toBe(900_000);
    expect(() => contentPreviewTtlMs("29")).toThrow(/CONTENT_PREVIEW_TTL_SECONDS/u);
    expect(() => contentPreviewTtlMs("901")).toThrow(/CONTENT_PREVIEW_TTL_SECONDS/u);
  });
});

describe("ContentPreviewService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    vi.stubEnv("CONTENT_PREVIEW_TTL_SECONDS", undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("issues an opaque token for an immutable revision without persisting the bearer value", async () => {
    const { prisma, service, transaction } = fixture();
    prisma.contentEntry.findUnique.mockResolvedValue({ id: entryId, revision: 7 });
    prisma.contentEntrySnapshot.findUnique.mockResolvedValue({ locales: [localeSnapshot] });

    const issued = await service.issue(actorId, siteId, entryId, { localeId });

    expect(issued).toMatchObject({
      expiresAt: "2026-09-26T22:05:00.000Z",
      id: "preview-id",
      revision: 7,
    });
    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{32}$/u);
    const persisted = transaction.contentPreviewToken.create.mock.calls[0]?.[0].data;
    expect(persisted.tokenHash).toBe(
      createHash("sha256").update(issued.token, "utf8").digest("hex"),
    );
    expect(JSON.stringify(persisted)).not.toContain(issued.token);
    expect(transaction.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "content.preview.issued",
          actorId,
          entityId: entryId,
        }),
      }),
    );
  });

  it("rejects malformed requests and locales absent from the requested snapshot", async () => {
    const malformed = fixture();
    await expect(
      malformed.service.issue(actorId, siteId, entryId, { localeId: "invalid" }),
    ).rejects.toBeInstanceOf(InvalidContentPreviewRequestError);

    const missingLocale = fixture();
    missingLocale.prisma.contentEntry.findUnique.mockResolvedValue({ id: entryId, revision: 4 });
    missingLocale.prisma.contentEntrySnapshot.findUnique.mockResolvedValue({
      locales: [localeSnapshot],
    });
    await expect(
      missingLocale.service.issue(actorId, siteId, entryId, {
        localeId: "60000000-0000-4000-8000-000000000006",
      }),
    ).rejects.toBeInstanceOf(ContentPreviewNotFoundError);
  });

  it("selects a locale from the historical snapshot when the caller omits it", async () => {
    const { prisma, service, transaction } = fixture();
    prisma.contentEntry.findUnique.mockResolvedValue({ id: entryId, revision: 7 });
    prisma.contentEntrySnapshot.findUnique.mockResolvedValue({ locales: [localeSnapshot] });

    await expect(service.issue(actorId, siteId, entryId, { revision: 4 })).resolves.toMatchObject({
      localeId,
      revision: 4,
    });
    expect(prisma.contentEntrySnapshot.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          contentEntryId_siteId_revision: { contentEntryId: entryId, revision: 4, siteId },
        },
      }),
    );
    expect(transaction.contentPreviewToken.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ localeId, revision: 4 }) }),
    );
  });

  it("redeems only the token-scoped site, revision and locale and reports pending publication", async () => {
    const { prisma, service } = fixture();
    const token = "A".repeat(32);
    prisma.contentPreviewToken.findFirst.mockResolvedValue({
      contentEntryId: entryId,
      expiresAt: new Date("2026-09-26T22:05:00.000Z"),
      localeId,
      revision: 7,
      siteId,
    });
    prisma.contentEntrySnapshot.findUnique.mockResolvedValue({
      createdAt: new Date("2026-09-26T21:59:00.000Z"),
      locales: [localeSnapshot],
      revision: 7,
      schemaVersion: 2,
      status: "DRAFT",
    });
    prisma.contentEntry.findUnique.mockResolvedValue({
      contentType: { displayName: "Article", key: "article" },
      revision: 7,
      site: { key: "nexora", name: "Nexora", status: "ACTIVE" },
    });
    prisma.publicationSchedule.findFirst.mockResolvedValue({
      action: "PUBLISH",
      scheduledFor: new Date("2026-09-27T12:00:00.000Z"),
    });

    await expect(service.redeem(token)).resolves.toMatchObject({
      data: localeSnapshot.data,
      id: entryId,
      locale: "pt-BR",
      revision: 7,
      scheduledPublication: {
        action: "PUBLISH",
        scheduledFor: "2026-09-27T12:00:00.000Z",
      },
      status: "DRAFT",
    });
    expect(prisma.contentPreviewToken.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          expiresAt: { gt: now },
          revokedAt: null,
          tokenHash: createHash("sha256").update(token, "utf8").digest("hex"),
        }),
      }),
    );
    expect(prisma.contentEntrySnapshot.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          contentEntryId_siteId_revision: { contentEntryId: entryId, revision: 7, siteId },
        },
      }),
    );
  });

  it("does not resolve malformed, expired or revoked bearer tokens", async () => {
    const { prisma, service } = fixture();
    await expect(service.redeem("not-a-token")).rejects.toBeInstanceOf(ContentPreviewNotFoundError);
    expect(prisma.contentPreviewToken.findFirst).not.toHaveBeenCalled();

    prisma.contentPreviewToken.findFirst.mockResolvedValue(null);
    await expect(service.redeem("B".repeat(32))).rejects.toBeInstanceOf(
      ContentPreviewNotFoundError,
    );
  });

  it("authorizes only assets referenced by the token-scoped locale snapshot", async () => {
    const { prisma, service } = fixture();
    prisma.contentPreviewToken.findFirst.mockResolvedValue({
      contentEntryId: entryId,
      expiresAt: new Date("2026-09-26T22:05:00.000Z"),
      localeId,
      revision: 7,
      siteId,
    });
    prisma.contentEntrySnapshot.findUnique.mockResolvedValue({
      createdAt: now,
      locales: [localeSnapshot],
      revision: 7,
      schemaVersion: 2,
      status: "DRAFT",
    });
    prisma.contentEntry.findUnique.mockResolvedValue({
      contentType: { displayName: "Article", key: "article" },
      revision: 7,
      site: { key: "nexora", name: "Nexora", status: "ACTIVE" },
    });
    prisma.asset.findUnique.mockResolvedValue({ version: 3 });

    await expect(service.authorizeAsset("C".repeat(32), assetId)).resolves.toEqual({
      siteId,
      version: 3,
    });
    await expect(
      service.authorizeAsset("C".repeat(32), "70000000-0000-4000-8000-000000000007"),
    ).rejects.toBeInstanceOf(ContentPreviewNotFoundError);
    expect(prisma.asset.findUnique).toHaveBeenCalledTimes(1);
  });
});
