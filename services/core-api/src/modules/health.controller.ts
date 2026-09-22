import { Controller, Get, Inject } from "@nestjs/common";
import { runtimeConfig } from "@nexora/config";
import { ContentMetrics } from "./content/content-metrics.js";

@Controller()
export class HealthController {
  constructor(@Inject(ContentMetrics) private readonly contentMetrics: ContentMetrics) {}

  @Get("health")
  health() {
    return {
      service: "core-api",
      status: "ok",
      timestamp: new Date().toISOString(),
    };
  }

  @Get("ready")
  readiness() {
    const config = runtimeConfig();

    return {
      service: "core-api",
      status: "ready",
      dependencies: {
        database: Boolean(config.databaseUrl),
        redis: Boolean(config.redisUrl),
        rabbitmq: Boolean(config.rabbitmqUrl),
        objectStorage: Boolean(config.minioEndpoint),
      },
    };
  }

  @Get("metrics")
  metrics() {
    return this.contentMetrics.render();
  }
}
