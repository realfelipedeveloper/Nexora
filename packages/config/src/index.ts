import { z } from "zod";

const configSchema = z.object({
  databaseUrl: z.string().optional(),
  redisUrl: z.string().default("redis://localhost:48140"),
  rabbitmqUrl: z.string().optional(),
  minioEndpoint: z.string().default("http://localhost:48160"),
});

export function runtimeConfig() {
  return configSchema.parse({
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: process.env.REDIS_URL,
    rabbitmqUrl: process.env.RABBITMQ_URL,
    minioEndpoint: process.env.MINIO_ENDPOINT,
  });
}
