import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  ContentAssetRelationService,
  InvalidAssetReferenceError,
} from "./content-asset-relation.service.js";

const definition = {
  displayName: "Article",
  fields: [
    { config: {}, fieldType: "media", key: "cover", label: "Cover", position: 0, required: false },
    {
      config: { maxItems: 20 },
      fieldType: "gallery",
      key: "gallery",
      label: "Gallery",
      position: 1,
      required: false,
    },
  ],
  key: "article",
  version: 1,
};

function transaction(assetCount: number) {
  return {
    asset: { count: vi.fn().mockResolvedValue(assetCount) },
    contentAssetRelation: {
      createMany: vi.fn().mockResolvedValue({ count: 3 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      findMany: vi.fn().mockResolvedValue([]),
    },
  } as unknown as Prisma.TransactionClient;
}

describe("ContentAssetRelationService", () => {
  it("synchronizes ordered media and gallery references for each locale", async () => {
    const prisma = transaction(3);
    const service = new ContentAssetRelationService();
    await service.synchronize(
      prisma,
      "site-1",
      "entry-1",
      [
        {
          data: {
            cover: "00000000-0000-4000-8000-000000000001",
            gallery: [
              "00000000-0000-4000-8000-000000000002",
              "00000000-0000-4000-8000-000000000003",
            ],
          },
          localeId: "locale-1",
        },
      ],
      definition,
    );

    expect(prisma.asset.count).toHaveBeenCalledWith({
      where: {
        id: { in: expect.arrayContaining(["00000000-0000-4000-8000-000000000001"]) },
        siteId: "site-1",
        status: "READY",
      },
    });
    expect(prisma.contentAssetRelation.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ role: "cover", position: 0 }),
        expect.objectContaining({ role: "gallery", position: 1 }),
      ]),
    });
  });

  it("rejects missing or cross-site assets before replacing relations", async () => {
    const prisma = transaction(0);
    const service = new ContentAssetRelationService();
    await expect(
      service.synchronize(
        prisma,
        "site-1",
        "entry-1",
        [{ data: { cover: "00000000-0000-4000-8000-000000000001" }, localeId: "locale-1" }],
        definition,
      ),
    ).rejects.toBeInstanceOf(InvalidAssetReferenceError);
    expect(prisma.contentAssetRelation.deleteMany).not.toHaveBeenCalled();
  });
});
