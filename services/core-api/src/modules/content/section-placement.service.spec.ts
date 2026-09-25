import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { ContentMetrics } from "./content-metrics.js";
import {
  InvalidSectionInputError,
  PlacementNotFoundError,
  SectionNotFoundError,
  SectionPlacementService,
} from "./section-placement.service.js";

function fixture() {
  const transaction = {
    auditEvent: { create: vi.fn().mockResolvedValue({}) },
    contentEntry: { findUnique: vi.fn() },
    contentPlacement: {
      delete: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      upsert: vi.fn(),
    },
    section: { findUnique: vi.fn() },
  };
  const prisma = {
    $transaction: vi.fn(async (callback: (client: typeof transaction) => unknown) =>
      callback(transaction),
    ),
  } as unknown as PrismaClient;
  const metrics = { recordSectionMutation: vi.fn() } as unknown as ContentMetrics;
  return { metrics, service: new SectionPlacementService(prisma, metrics), transaction };
}

describe("section placement service", () => {
  it("makes the first placement primary and audits it", async () => {
    const { metrics, service, transaction } = fixture();
    transaction.section.findUnique.mockResolvedValue({ id: "section-1", key: "news" });
    transaction.contentEntry.findUnique.mockResolvedValue({ id: "entry-1" });
    transaction.contentPlacement.findFirst.mockResolvedValue(null);
    transaction.contentPlacement.updateMany.mockResolvedValue({ count: 0 });
    transaction.contentPlacement.upsert.mockResolvedValue({
      contentEntryId: "entry-1",
      id: "placement-1",
      isPrimary: true,
      isVisible: true,
      position: 3,
      sectionId: "section-1",
    });

    await expect(
      service.putPlacement("actor-1", "site-1", "section-1", "entry-1", {
        isPrimary: false,
        isVisible: true,
        position: 3,
      }),
    ).resolves.toMatchObject({ isPrimary: true });
    expect(transaction.contentPlacement.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ isPrimary: true, position: 3 }),
      }),
    );
    expect(transaction.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "content.placement.saved" }),
      }),
    );
    expect(metrics.recordSectionMutation).toHaveBeenCalledWith("placement_saved");
  });

  it("promotes the next ordered placement after deleting the primary", async () => {
    const { metrics, service, transaction } = fixture();
    transaction.contentPlacement.findFirst
      .mockResolvedValueOnce({ id: "placement-1", isPrimary: true })
      .mockResolvedValueOnce({ id: "placement-2" });
    transaction.contentPlacement.delete.mockResolvedValue({ id: "placement-1" });
    transaction.contentPlacement.update.mockResolvedValue({ id: "placement-2", isPrimary: true });

    await expect(
      service.deletePlacement("actor-1", "site-1", "section-1", "entry-1"),
    ).resolves.toBeUndefined();
    expect(transaction.contentPlacement.update).toHaveBeenCalledWith({
      data: { isPrimary: true },
      where: { id: "placement-2" },
    });
    expect(metrics.recordSectionMutation).toHaveBeenCalledWith("placement_deleted");
  });

  it("fails closed for a missing cross-site section or entry", async () => {
    const { service, transaction } = fixture();
    transaction.section.findUnique.mockResolvedValue(null);
    transaction.contentEntry.findUnique.mockResolvedValue({ id: "entry-1" });

    await expect(
      service.putPlacement("actor-1", "site-1", "section-elsewhere", "entry-1", {}),
    ).rejects.toBeInstanceOf(SectionNotFoundError);

    transaction.section.findUnique.mockResolvedValue({ id: "section-1", key: "news" });
    transaction.contentEntry.findUnique.mockResolvedValue(null);
    await expect(
      service.putPlacement("actor-1", "site-1", "section-1", "entry-elsewhere", {}),
    ).rejects.toBeInstanceOf(PlacementNotFoundError);
  });

  it("rejects unbounded placement input before opening a transaction", async () => {
    const { service } = fixture();
    await expect(
      service.putPlacement("actor-1", "site-1", "section-1", "entry-1", { position: -1 }),
    ).rejects.toBeInstanceOf(InvalidSectionInputError);
  });
});
