import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";
import { CacheModule } from "./cache.module.js";
import { DistributedCacheService } from "./distributed-cache.service.js";

describe("CacheModule", () => {
  it("resolves the cache without connecting during application bootstrap", async () => {
    const moduleRef = await Test.createTestingModule({ imports: [CacheModule] }).compile();

    expect(moduleRef.get(DistributedCacheService)).toBeInstanceOf(DistributedCacheService);
    await moduleRef.close();
  });
});
