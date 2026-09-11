import { Controller, Get } from "@nestjs/common";
import { runtimeConfig } from "@nexora/config";

@Controller()
export class HealthController {
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
    return "# Nexora metrics baseline\nnexora_core_api_up 1\n";
  }
}
