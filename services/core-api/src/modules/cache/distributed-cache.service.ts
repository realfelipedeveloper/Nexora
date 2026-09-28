import { createHash, randomUUID } from "node:crypto";
import { Inject, Injectable, Optional } from "@nestjs/common";
import { runtimeConfig } from "@nexora/config";
import { CacheMetrics } from "./cache-metrics.js";
import { RedisCacheClient } from "./redis-cache.client.js";

const cacheSchemaVersion = "v1";
const lockTtlMilliseconds = 2_000;
const lockWaitAttempts = 4;
const maximumCacheValueBytes = 512 * 1024;
const hotKeyWindowMilliseconds = 60_000;
const defaultHotKeyThreshold = 100;

type CachePolicy = {
  identity: readonly string[];
  negativeTtlSeconds?: number;
  resource: string;
  siteId: string;
  ttlSeconds?: number;
};

type CacheEnvelope<Value> =
  | { found: false; version: 1 }
  | { found: true; value: Value; version: 1 };

type CacheRead<Value> =
  | { state: "hit"; value: Value | null }
  | { state: "miss" }
  | { state: "unavailable" };

type CacheServiceOptions = {
  hotKeyThreshold?: number;
  random?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
};

export const CACHE_SERVICE_OPTIONS = Symbol("CACHE_SERVICE_OPTIONS");

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function digest(parts: readonly string[]) {
  return createHash("sha256").update(JSON.stringify(parts)).digest("base64url");
}

@Injectable()
export class DistributedCacheService {
  private readonly defaultNegativeTtlSeconds: number;
  private readonly defaultTtlSeconds: number;
  private readonly hotKeyCounts = new Map<string, number>();
  private hotKeyWindowStartedAt = Date.now();
  private readonly hotKeyThreshold: number;
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private lastStatsRefreshAt = 0;
  private readonly prefix: string;
  private readonly random: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(
    @Inject(RedisCacheClient) private readonly redis: RedisCacheClient,
    @Inject(CacheMetrics) private readonly metrics: CacheMetrics,
    @Optional()
    @Inject(CACHE_SERVICE_OPTIONS)
    options: CacheServiceOptions = {},
  ) {
    const config = runtimeConfig();
    this.defaultNegativeTtlSeconds = config.cacheNegativeTtlSeconds;
    this.defaultTtlSeconds = config.cacheTtlSeconds;
    this.hotKeyThreshold = options.hotKeyThreshold ?? defaultHotKeyThreshold;
    this.prefix = `${config.cacheNamespace}:${config.environment}:${cacheSchemaVersion}`;
    this.random = options.random ?? Math.random;
    this.sleep = options.sleep ?? wait;
  }

  async getOrLoad<Value>(
    policy: CachePolicy,
    loader: () => Promise<Value | null>,
  ): Promise<Value | null> {
    const generation = await this.generation(policy.siteId);
    if (!generation) return this.coalesce(this.fallbackKey(policy), loader);

    const key = this.dataKey(policy, generation);
    this.observeKey(key);
    void this.refreshStats();
    const cached = await this.read<Value>(key);
    if (cached.state === "hit") return cached.value;
    if (cached.state === "unavailable") return this.coalesce(key, loader);
    this.metrics.record("miss");
    return this.coalesce(key, () => this.loadWithDistributedLock(key, policy, loader));
  }

  async invalidateSite(siteId: string) {
    try {
      await this.redis.set(this.generationKey(siteId), randomUUID());
      this.metrics.record("invalidation");
    } catch {
      this.metrics.record("error");
    }
  }

  private async generation(siteId: string) {
    const key = this.generationKey(siteId);
    try {
      const current = await this.redis.get(key);
      if (current) return current;
      const candidate = randomUUID();
      await this.redis.setIfAbsent(key, candidate);
      return (await this.redis.get(key)) ?? candidate;
    } catch {
      this.metrics.record("error");
      return null;
    }
  }

  private async read<Value>(key: string): Promise<CacheRead<Value>> {
    let raw: string | null;
    try {
      raw = await this.redis.get(key);
    } catch {
      this.metrics.record("error");
      return { state: "unavailable" };
    }
    if (raw === null) return { state: "miss" };
    try {
      const envelope = JSON.parse(raw) as CacheEnvelope<Value>;
      if (envelope.version !== 1 || typeof envelope.found !== "boolean") throw new Error();
      if (!envelope.found) {
        this.metrics.record("negative_hit");
        return { state: "hit", value: null };
      }
      if (!("value" in envelope)) throw new Error();
      this.metrics.record("hit");
      return { state: "hit", value: envelope.value };
    } catch {
      this.metrics.record("error");
      void this.redis.delete(key).catch(() => undefined);
      return { state: "miss" };
    }
  }

  private async loadWithDistributedLock<Value>(
    key: string,
    policy: CachePolicy,
    loader: () => Promise<Value | null>,
  ) {
    const lockKey = `${key}:lock`;
    const token = randomUUID();
    let ownsLock = false;
    try {
      ownsLock = (await this.redis.setIfAbsent(lockKey, token, lockTtlMilliseconds)) === "OK";
    } catch {
      this.metrics.record("error");
    }
    if (!ownsLock) {
      this.metrics.record("lock_wait");
      for (let attempt = 0; attempt < lockWaitAttempts; attempt += 1) {
        await this.sleep(25 + Math.floor(this.random() * 25));
        const cached = await this.read<Value>(key);
        if (cached.state === "hit") return cached.value;
        if (cached.state === "unavailable") break;
      }
    }
    try {
      const value = await loader();
      this.metrics.record("load");
      await this.write(key, value, policy);
      return value;
    } finally {
      if (ownsLock) void this.redis.releaseLock(lockKey, token).catch(() => undefined);
    }
  }

  private async write<Value>(key: string, value: Value | null, policy: CachePolicy) {
    const envelope: CacheEnvelope<Value> =
      value === null ? { found: false, version: 1 } : { found: true, value, version: 1 };
    const serialized = JSON.stringify(envelope);
    if (Buffer.byteLength(serialized) > maximumCacheValueBytes) {
      this.metrics.record("oversize");
      return;
    }
    const baseTtl =
      value === null
        ? (policy.negativeTtlSeconds ?? this.defaultNegativeTtlSeconds)
        : (policy.ttlSeconds ?? this.defaultTtlSeconds);
    const ttl = Math.max(1, Math.round(baseTtl * (0.9 + this.random() * 0.2)));
    try {
      await this.redis.setExpiring(key, serialized, ttl);
      this.metrics.record("write");
    } catch {
      this.metrics.record("error");
    }
  }

  private coalesce<Value>(key: string, loader: () => Promise<Value | null>) {
    const existing = this.inFlight.get(key) as Promise<Value | null> | undefined;
    if (existing) {
      this.metrics.record("lock_wait");
      return existing;
    }
    const current = loader();
    this.inFlight.set(key, current);
    const cleanup = () => {
      if (this.inFlight.get(key) === current) this.inFlight.delete(key);
    };
    void current.then(cleanup, cleanup);
    return current;
  }

  private observeKey(key: string) {
    const now = Date.now();
    if (
      now - this.hotKeyWindowStartedAt >= hotKeyWindowMilliseconds ||
      this.hotKeyCounts.size >= 10_000
    ) {
      this.hotKeyCounts.clear();
      this.hotKeyWindowStartedAt = now;
    }
    const count = (this.hotKeyCounts.get(key) ?? 0) + 1;
    this.hotKeyCounts.set(key, count);
    if (count === this.hotKeyThreshold) this.metrics.recordHotKey();
  }

  private async refreshStats() {
    const now = Date.now();
    if (now - this.lastStatsRefreshAt < 30_000) return;
    this.lastStatsRefreshAt = now;
    try {
      const stats = await this.redis.info("stats");
      const evictions = /^evicted_keys:(\d+)$/mu.exec(stats)?.[1];
      if (evictions) this.metrics.setEvictions(Number(evictions));
    } catch {
      this.metrics.record("error");
    }
  }

  private dataKey(policy: CachePolicy, generation: string) {
    return `${this.sitePrefix(policy.siteId)}:g:${generation}:${policy.resource}:${digest(policy.identity)}`;
  }

  private fallbackKey(policy: CachePolicy) {
    return `${this.sitePrefix(policy.siteId)}:fallback:${policy.resource}:${digest(policy.identity)}`;
  }

  private generationKey(siteId: string) {
    return `${this.sitePrefix(siteId)}:generation`;
  }

  private sitePrefix(siteId: string) {
    return `${this.prefix}:site:${Buffer.from(siteId).toString("base64url")}`;
  }
}
