import { Global, Module } from "@nestjs/common";
import { CacheMetrics } from "./cache-metrics.js";
import { DistributedCacheService } from "./distributed-cache.service.js";
import { RedisCacheClient } from "./redis-cache.client.js";

@Global()
@Module({
  exports: [CacheMetrics, DistributedCacheService],
  providers: [CacheMetrics, DistributedCacheService, RedisCacheClient],
})
export class CacheModule {}
