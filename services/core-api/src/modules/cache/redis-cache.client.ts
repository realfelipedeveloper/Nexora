import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { runtimeConfig } from "@nexora/config";
import { Redis } from "ioredis";

@Injectable()
export class RedisCacheClient implements OnModuleDestroy {
  private readonly client: Redis;
  private connecting?: Promise<void>;

  constructor() {
    const { redisUrl } = runtimeConfig();
    this.client = new Redis(redisUrl, {
      commandTimeout: 500,
      connectTimeout: 500,
      enableOfflineQueue: false,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: (attempt: number) => Math.min(attempt * 100, 1_000),
    });
    this.client.on("error", () => undefined);
  }

  async get(key: string) {
    await this.ensureConnected();
    return this.client.get(key);
  }

  async set(key: string, value: string) {
    await this.ensureConnected();
    return this.client.set(key, value);
  }

  async setExpiring(key: string, value: string, ttlSeconds: number) {
    await this.ensureConnected();
    return this.client.set(key, value, "EX", ttlSeconds);
  }

  async setIfAbsent(key: string, value: string, ttlMilliseconds?: number) {
    await this.ensureConnected();
    return ttlMilliseconds
      ? this.client.set(key, value, "PX", ttlMilliseconds, "NX")
      : this.client.set(key, value, "NX");
  }

  async delete(key: string) {
    await this.ensureConnected();
    return this.client.del(key);
  }

  async releaseLock(key: string, token: string) {
    await this.ensureConnected();
    return this.client.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      key,
      token,
    );
  }

  async info(section: string) {
    await this.ensureConnected();
    return this.client.info(section);
  }

  private async ensureConnected() {
    if (this.client.status === "ready") return;
    if (this.client.status === "wait") {
      this.connecting ??= this.client.connect().finally(() => {
        this.connecting = undefined;
      });
    }
    if (this.connecting) await this.connecting;
    if (String(this.client.status) !== "ready") throw new Error("Redis cache is unavailable.");
  }

  async onModuleDestroy() {
    try {
      if (this.client.status === "ready") await this.client.quit();
      else this.client.disconnect(false);
    } catch {
      this.client.disconnect(false);
    }
  }
}
