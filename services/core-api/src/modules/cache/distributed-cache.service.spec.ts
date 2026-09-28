import { describe, expect, it, vi } from "vitest";
import { CacheMetrics } from "./cache-metrics.js";
import { DistributedCacheService } from "./distributed-cache.service.js";
import type { RedisCacheClient } from "./redis-cache.client.js";

function fixture() {
  const redis = {
    delete: vi.fn().mockResolvedValue(1),
    get: vi.fn().mockResolvedValue("generation-1"),
    info: vi.fn().mockResolvedValue("evicted_keys:3\n"),
    releaseLock: vi.fn().mockResolvedValue(1),
    set: vi.fn().mockResolvedValue("OK"),
    setExpiring: vi.fn().mockResolvedValue("OK"),
    setIfAbsent: vi.fn().mockResolvedValue("OK"),
  };
  const metrics = new CacheMetrics();
  const service = new DistributedCacheService(redis as unknown as RedisCacheClient, metrics, {
    hotKeyThreshold: 2,
    random: () => 0.5,
    sleep: async () => undefined,
  });
  return { metrics, redis, service };
}

const policy = {
  identity: ["article", "pt-BR", "entry-1"],
  resource: "content-detail",
  siteId: "site-1",
};

describe("DistributedCacheService", () => {
  it("returns a cached value without loading the canonical source", async () => {
    const { metrics, redis, service } = fixture();
    redis.get
      .mockResolvedValueOnce("generation-1")
      .mockResolvedValueOnce(
        JSON.stringify({ found: true, value: { title: "Cached" }, version: 1 }),
      );
    const loader = vi.fn();

    await expect(service.getOrLoad(policy, loader)).resolves.toEqual({ title: "Cached" });
    expect(loader).not.toHaveBeenCalled();
    expect(metrics.render()).toContain(
      'nexora_distributed_cache_operations_total{outcome="hit"} 1',
    );
  });

  it("loads a miss once and writes it with a bounded jittered TTL", async () => {
    const { redis, service } = fixture();
    redis.get.mockResolvedValueOnce("generation-1").mockResolvedValueOnce(null);

    await expect(service.getOrLoad(policy, async () => ({ title: "Origin" }))).resolves.toEqual({
      title: "Origin",
    });
    expect(redis.setExpiring).toHaveBeenCalledWith(
      expect.stringContaining(":site:"),
      JSON.stringify({ found: true, value: { title: "Origin" }, version: 1 }),
      60,
    );
  });

  it("uses a short negative entry for absent public content", async () => {
    const { metrics, redis, service } = fixture();
    redis.get.mockResolvedValueOnce("generation-1").mockResolvedValueOnce(null);
    await expect(service.getOrLoad(policy, async () => null)).resolves.toBeNull();
    expect(redis.setExpiring).toHaveBeenCalledWith(
      expect.any(String),
      JSON.stringify({ found: false, version: 1 }),
      10,
    );

    const key = redis.setExpiring.mock.calls[0]?.[0] as string;
    redis.get
      .mockResolvedValueOnce("generation-1")
      .mockResolvedValueOnce(JSON.stringify({ found: false, version: 1 }));
    await expect(service.getOrLoad(policy, vi.fn())).resolves.toBeNull();
    expect(redis.get).toHaveBeenLastCalledWith(key);
    expect(metrics.render()).toContain(
      'nexora_distributed_cache_operations_total{outcome="negative_hit"} 1',
    );
  });

  it("coalesces concurrent misses within the process", async () => {
    const { redis, service } = fixture();
    redis.get.mockImplementation(async (key: string) =>
      key.endsWith(":generation") ? "generation-1" : null,
    );
    let resolveLoader: ((value: { title: string }) => void) | undefined;
    const loader = vi.fn(
      () =>
        new Promise<{ title: string }>((resolve) => {
          resolveLoader = resolve;
        }),
    );

    const first = service.getOrLoad(policy, loader);
    const second = service.getOrLoad(policy, loader);
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
    resolveLoader?.({ title: "Shared" });
    await expect(Promise.all([first, second])).resolves.toEqual([
      { title: "Shared" },
      { title: "Shared" },
    ]);
  });

  it("falls back to the loader when Redis is unavailable", async () => {
    const { metrics, redis, service } = fixture();
    redis.get.mockRejectedValue(new Error("redis unavailable"));

    await expect(service.getOrLoad(policy, async () => ({ title: "Database" }))).resolves.toEqual({
      title: "Database",
    });
    expect(metrics.render()).toContain(
      'nexora_distributed_cache_operations_total{outcome="error"} 1',
    );
  });

  it("rotates only the requested site generation and exposes bounded metrics", async () => {
    const { metrics, redis, service } = fixture();
    await service.invalidateSite("site-1");

    expect(redis.set).toHaveBeenCalledWith(
      expect.stringContaining("site:c2l0ZS0x"),
      expect.any(String),
    );
    expect(metrics.render()).toContain(
      'nexora_distributed_cache_operations_total{outcome="invalidation"} 1',
    );
    expect(metrics.render()).toContain("nexora_distributed_cache_evictions 0");
  });

  it("uses distinct opaque cache keys for different sites", async () => {
    const { redis, service } = fixture();
    redis.get.mockImplementation(async (key: string) =>
      key.endsWith(":generation") ? "generation-1" : null,
    );

    await service.getOrLoad(policy, async () => ({ title: "Site one" }));
    await service.getOrLoad({ ...policy, siteId: "site-2" }, async () => ({ title: "Site two" }));

    const keys = redis.setExpiring.mock.calls.map(([key]) => key as string);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
    expect(keys.join(" ")).not.toContain("article");
  });

  it("counts a frequently accessed key without exposing the key as a metric label", async () => {
    const { metrics, redis, service } = fixture();
    const cached = JSON.stringify({ found: true, value: { title: "Cached" }, version: 1 });
    redis.get.mockImplementation(async (key: string) =>
      key.endsWith(":generation") ? "generation-1" : cached,
    );

    await service.getOrLoad(policy, vi.fn());
    await service.getOrLoad(policy, vi.fn());

    expect(metrics.render()).toContain("nexora_distributed_cache_hot_keys_total 1");
    expect(metrics.render()).not.toContain("site-1");
  });
});
