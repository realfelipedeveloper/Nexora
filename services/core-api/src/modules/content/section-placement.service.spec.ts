import { Prisma, type PrismaClient } from "@prisma/client";
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
    section: { create: vi.fn(), delete: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    sectionRoleAssignment: { create: vi.fn(), delete: vi.fn(), findFirst: vi.fn() },
    user: { findFirst: vi.fn() },
  };
  const client = {
    $transaction: vi.fn(async (callback: (client: typeof transaction) => unknown) =>
      callback(transaction),
    ),
    contentPlacement: { findFirst: vi.fn(), findMany: vi.fn() },
    section: { findMany: vi.fn(), findUnique: vi.fn() },
    sectionRoleAssignment: { findFirst: vi.fn(), findMany: vi.fn() },
  };
  const prisma = client as unknown as PrismaClient;
  const metrics = { recordSectionMutation: vi.fn() } as unknown as ContentMetrics;
  return { client, metrics, service: new SectionPlacementService(prisma, metrics), transaction };
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

  it("lists and retrieves sections with bounded cursor pagination", async () => {
    const { client, service } = fixture();
    client.section.findUnique.mockResolvedValue({ id: "00000000-0000-4000-8000-000000000001" });
    client.section.findMany.mockResolvedValue([
      { id: "section-1", key: "first" },
      { id: "section-2", key: "second" },
    ]);

    await expect(
      service.listSections("site-1", {
        cursor: "00000000-0000-4000-8000-000000000001",
        limit: "1",
        parentId: "root",
      }),
    ).resolves.toEqual({ items: [{ id: "section-1", key: "first" }], nextCursor: "section-1" });
    expect(client.section.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { parentId: null, siteId: "site-1" } }),
    );

    client.section.findUnique.mockResolvedValue({ id: "section-1", key: "news" });
    await expect(service.getSection("site-1", "section-1")).resolves.toMatchObject({ key: "news" });
    client.section.findUnique.mockResolvedValue(null);
    await expect(service.getSection("site-1", "missing")).rejects.toBeInstanceOf(
      SectionNotFoundError,
    );
  });

  it("rejects invalid section pagination variants", async () => {
    const { client, service } = fixture();
    await expect(service.listSections("site-1", { limit: "0" })).rejects.toThrow();
    await expect(service.listSections("site-1", { limit: "101" })).rejects.toThrow();
    await expect(service.listSections("site-1", { parentId: "invalid" })).rejects.toThrow();
    client.section.findUnique.mockResolvedValue(null);
    await expect(
      service.listSections("site-1", {
        cursor: "00000000-0000-4000-8000-000000000001",
      }),
    ).rejects.toThrow();
  });

  it("creates, reparents, and deletes sections atomically with audit", async () => {
    const { metrics, service, transaction } = fixture();
    transaction.section.findUnique.mockResolvedValue({ id: "parent-1", key: "parent" });
    transaction.section.create.mockResolvedValue({
      id: "section-1",
      key: "news",
      name: "News",
      parentId: "parent-1",
    });
    transaction.section.update.mockResolvedValue({
      id: "section-1",
      key: "news",
      name: "Latest news",
      parentId: null,
    });
    transaction.section.delete.mockResolvedValue({ id: "section-1" });

    await expect(
      service.createSection("actor-1", "site-1", {
        key: "news",
        name: "News",
        parentId: "00000000-0000-4000-8000-000000000001",
      }),
    ).resolves.toMatchObject({ key: "news" });
    await expect(
      service.updateSection("actor-1", "site-1", "section-1", {
        name: "Latest news",
        parentId: null,
      }),
    ).resolves.toMatchObject({ name: "Latest news" });
    await expect(service.deleteSection("actor-1", "site-1", "section-1")).resolves.toBeUndefined();
    expect(metrics.recordSectionMutation).toHaveBeenCalledWith("section_created");
    expect(metrics.recordSectionMutation).toHaveBeenCalledWith("section_updated");
    expect(metrics.recordSectionMutation).toHaveBeenCalledWith("section_deleted");
  });

  it("maps database hierarchy conflicts and preserves unexpected errors", async () => {
    const { client, service } = fixture();
    const conflict = new Prisma.PrismaClientKnownRequestError("constraint", {
      clientVersion: "test",
      code: "P2003",
    });
    client.$transaction.mockRejectedValueOnce(conflict);
    await expect(
      service.createSection("actor-1", "site-1", { key: "news", name: "News" }),
    ).rejects.toMatchObject({ name: "SectionConflictError" });

    const failure = new Error("database unavailable");
    client.$transaction.mockRejectedValueOnce(failure);
    await expect(
      service.updateSection("actor-1", "site-1", "section-1", {
        name: "News",
        parentId: null,
      }),
    ).rejects.toBe(failure);
    await expect(service.createSection("actor-1", "site-1", {})).rejects.toBeInstanceOf(
      InvalidSectionInputError,
    );
  });

  it("lists placements by visibility and validates their cursor", async () => {
    const { client, service } = fixture();
    client.section.findUnique.mockResolvedValue({ id: "section-1", key: "news" });
    client.contentPlacement.findFirst.mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000001",
    });
    client.contentPlacement.findMany.mockResolvedValue([{ id: "placement-1" }]);

    await expect(
      service.listPlacements("site-1", "section-1", {
        cursor: "00000000-0000-4000-8000-000000000001",
        visible: "false",
      }),
    ).resolves.toEqual({ items: [{ id: "placement-1" }], nextCursor: undefined });
    expect(client.contentPlacement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isVisible: false, sectionId: "section-1", siteId: "site-1" },
      }),
    );
    await expect(
      service.listPlacements("site-1", "section-1", { visible: "yes" }),
    ).rejects.toThrow();
    client.contentPlacement.findFirst.mockResolvedValue(null);
    await expect(
      service.listPlacements("site-1", "section-1", {
        cursor: "00000000-0000-4000-8000-000000000001",
      }),
    ).rejects.toThrow();
  });

  it("keeps a non-primary placement when another primary exists and maps races", async () => {
    const { client, service, transaction } = fixture();
    transaction.section.findUnique.mockResolvedValue({ id: "section-1", key: "news" });
    transaction.contentEntry.findUnique.mockResolvedValue({ id: "entry-1" });
    transaction.contentPlacement.findFirst.mockResolvedValue({ id: "primary-1" });
    transaction.contentPlacement.upsert.mockResolvedValue({ id: "placement-1", isPrimary: false });

    await expect(
      service.putPlacement("actor-1", "site-1", "section-1", "entry-1", {}),
    ).resolves.toMatchObject({ isPrimary: false });
    expect(transaction.contentPlacement.updateMany).not.toHaveBeenCalled();

    const conflict = new Prisma.PrismaClientKnownRequestError("duplicate", {
      clientVersion: "test",
      code: "P2002",
    });
    client.$transaction.mockRejectedValueOnce(conflict);
    await expect(
      service.putPlacement("actor-1", "site-1", "section-1", "entry-1", {}),
    ).rejects.toMatchObject({ name: "PlacementConflictError" });
  });

  it("handles missing and non-primary placement deletion", async () => {
    const { service, transaction } = fixture();
    transaction.contentPlacement.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.deletePlacement("actor-1", "site-1", "section-1", "entry-1"),
    ).rejects.toBeInstanceOf(PlacementNotFoundError);

    transaction.contentPlacement.findFirst.mockResolvedValueOnce({
      id: "placement-1",
      isPrimary: false,
    });
    transaction.contentPlacement.delete.mockResolvedValue({ id: "placement-1" });
    await expect(
      service.deletePlacement("actor-1", "site-1", "section-1", "entry-1"),
    ).resolves.toBeUndefined();
    expect(transaction.contentPlacement.update).not.toHaveBeenCalled();
  });

  it("lists, creates, and deletes section role assignments", async () => {
    const { client, metrics, service, transaction } = fixture();
    client.section.findUnique.mockResolvedValue({ id: "section-1", key: "news" });
    client.sectionRoleAssignment.findFirst.mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000001",
    });
    client.sectionRoleAssignment.findMany.mockResolvedValue([{ id: "assignment-1" }]);
    await expect(
      service.listRoleAssignments("site-1", "section-1", {
        cursor: "00000000-0000-4000-8000-000000000001",
        limit: "25",
      }),
    ).resolves.toEqual({ items: [{ id: "assignment-1" }], nextCursor: undefined });

    transaction.section.findUnique.mockResolvedValue({ id: "section-1", key: "news" });
    transaction.user.findFirst.mockResolvedValue({ id: "00000000-0000-4000-8000-000000000002" });
    transaction.sectionRoleAssignment.create.mockResolvedValue({ id: "assignment-1" });
    transaction.sectionRoleAssignment.findFirst.mockResolvedValue({
      id: "assignment-1",
      roleKey: "editor",
      userId: "00000000-0000-4000-8000-000000000002",
    });
    await expect(
      service.createRoleAssignment("actor-1", "site-1", "section-1", {
        roleKey: "editor",
        userId: "00000000-0000-4000-8000-000000000002",
      }),
    ).resolves.toEqual({ id: "assignment-1" });
    await expect(
      service.deleteRoleAssignment("actor-1", "site-1", "section-1", "assignment-1"),
    ).resolves.toBeUndefined();
    expect(metrics.recordSectionMutation).toHaveBeenCalledWith("role_granted");
    expect(metrics.recordSectionMutation).toHaveBeenCalledWith("role_revoked");
  });

  it("rejects unavailable members, duplicate roles, and missing assignments", async () => {
    const { client, service, transaction } = fixture();
    transaction.section.findUnique.mockResolvedValue({ id: "section-1", key: "news" });
    transaction.user.findFirst.mockResolvedValue(null);
    await expect(
      service.createRoleAssignment("actor-1", "site-1", "section-1", {
        roleKey: "editor",
        userId: "00000000-0000-4000-8000-000000000002",
      }),
    ).rejects.toMatchObject({ name: "SectionMemberUnavailableError" });

    const duplicate = new Prisma.PrismaClientKnownRequestError("duplicate", {
      clientVersion: "test",
      code: "P2002",
    });
    client.$transaction.mockRejectedValueOnce(duplicate);
    await expect(
      service.createRoleAssignment("actor-1", "site-1", "section-1", {
        roleKey: "editor",
        userId: "00000000-0000-4000-8000-000000000002",
      }),
    ).rejects.toMatchObject({ name: "SectionRoleAssignmentConflictError" });
    await expect(
      service.createRoleAssignment("actor-1", "site-1", "section-1", { roleKey: "owner" }),
    ).rejects.toBeInstanceOf(InvalidSectionInputError);

    transaction.sectionRoleAssignment.findFirst.mockResolvedValue(null);
    await expect(
      service.deleteRoleAssignment("actor-1", "site-1", "section-1", "missing"),
    ).rejects.toMatchObject({ name: "SectionRoleAssignmentNotFoundError" });
  });
});
