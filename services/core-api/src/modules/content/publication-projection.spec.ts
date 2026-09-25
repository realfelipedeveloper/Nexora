import { describe, expect, it, vi } from "vitest";
import {
  createPublicationEvent,
  removePublishedProjection,
  replacePublishedProjection,
} from "./publication-projection.js";

function fixture() {
  return {
    contentEntry: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        contentLocales: [
          {
            data: { title: "Public title" },
            locale: { code: "pt-BR" },
            localeId: "locale-1",
          },
        ],
        contentType: { key: "article" },
        schemaVersion: 3,
      }),
    },
    domainEvent: { create: vi.fn().mockResolvedValue({}) },
    publishedContentEntry: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      upsert: vi.fn().mockResolvedValue({}),
    },
  };
}

describe("publication projection", () => {
  it("atomically replaces every localized public projection", async () => {
    const transaction = fixture();
    const publishedAt = new Date("2026-09-25T18:00:00.000Z");
    await replacePublishedProjection(transaction as never, "site-1", "entry-1", publishedAt, 7);
    expect(transaction.publishedContentEntry.deleteMany).toHaveBeenCalledWith({
      where: { contentEntryId: "entry-1", localeId: { notIn: ["locale-1"] }, siteId: "site-1" },
    });
    expect(transaction.publishedContentEntry.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          contentEntryId: "entry-1",
          data: { title: "Public title" },
          editorialRevision: 7,
          publishedAt,
        }),
      }),
    );
  });

  it("removes public data and writes a content-free domain event", async () => {
    const transaction = fixture();
    await removePublishedProjection(transaction as never, "site-1", "entry-1");
    await createPublicationEvent(transaction as never, {
      contentEntryId: "entry-1",
      publishedAt: null,
      revision: 8,
      siteId: "site-1",
      type: "content.unpublished",
    });
    expect(transaction.publishedContentEntry.deleteMany).toHaveBeenCalledWith({
      where: { contentEntryId: "entry-1", siteId: "site-1" },
    });
    expect(transaction.domainEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          payload: {
            contentEntryId: "entry-1",
            publishedAt: null,
            revision: 8,
            siteId: "site-1",
          },
          type: "content.unpublished",
        }),
      }),
    );
  });
});
