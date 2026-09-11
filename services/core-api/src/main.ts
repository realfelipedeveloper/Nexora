import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./modules/app.module.js";
import { configureHttpSecurity } from "./modules/http-security.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: false });
  configureHttpSecurity(app);
  app.enableShutdownHooks();

  const port = Number(process.env.CORE_API_PORT ?? 48120);
  await app.listen(port, "0.0.0.0");
}

void bootstrap();
