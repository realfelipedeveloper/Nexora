import { Controller, Get } from "@nestjs/common";

@Controller()
export class HealthController {
  @Get("health")
  health() {
    return {
      service: "notification-api",
      status: "ok",
      timestamp: new Date().toISOString(),
    };
  }

  @Get("ready")
  readiness() {
    return {
      service: "notification-api",
      status: "ready",
      dependencies: {
        mail: Boolean(process.env.MAILPIT_SMTP_HOST ?? "localhost"),
        queue: Boolean(process.env.RABBITMQ_URL),
      },
    };
  }

  @Get("metrics")
  metrics() {
    return "# Nexora metrics baseline\nnexora_notification_api_up 1\n";
  }
}
