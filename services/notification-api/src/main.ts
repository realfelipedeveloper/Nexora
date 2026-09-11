import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./modules/app.module.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: false });
  app.enableShutdownHooks();

  const port = Number(process.env.NOTIFICATION_API_PORT ?? 48121);
  await app.listen(port, "0.0.0.0");
}

void bootstrap();
