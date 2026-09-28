import { z } from "zod";

const configSchema = z.object({
  cacheNamespace: z
    .string()
    .regex(/^[a-z][a-z0-9-]{0,31}$/u)
    .default("nexora"),
  cacheNegativeTtlSeconds: z.coerce.number().int().min(1).max(60).default(10),
  cacheTtlSeconds: z.coerce.number().int().min(5).max(3600).default(60),
  databaseUrl: z.string().optional(),
  environment: z.enum(["development", "test", "production"]).default("development"),
  redisUrl: z.string().default("redis://localhost:48140"),
  rabbitmqUrl: z.string().optional(),
  minioEndpoint: z.string().default("http://localhost:48160"),
});

export function runtimeConfig() {
  return configSchema.parse({
    cacheNamespace: process.env.CACHE_NAMESPACE,
    cacheNegativeTtlSeconds: process.env.CACHE_NEGATIVE_TTL_SECONDS,
    cacheTtlSeconds: process.env.CACHE_TTL_SECONDS,
    databaseUrl: process.env.DATABASE_URL,
    environment: process.env.NODE_ENV,
    redisUrl: process.env.REDIS_URL,
    rabbitmqUrl: process.env.RABBITMQ_URL,
    minioEndpoint: process.env.MINIO_ENDPOINT,
  });
}
