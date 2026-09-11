import type { INestApplication } from "@nestjs/common";
import rateLimit from "express-rate-limit";
import helmet from "helmet";

const rateLimitWindowMs = Number(process.env.HTTP_RATE_LIMIT_WINDOW_MS ?? 60_000);
const rateLimitMaxRequests = Number(process.env.HTTP_RATE_LIMIT_MAX_REQUESTS ?? 300);

export function configureHttpSecurity(app: INestApplication) {
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          baseUri: ["'self'"],
          defaultSrc: ["'self'"],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
        },
      },
      frameguard: {
        action: "deny",
      },
    }),
  );

  app.use(
    rateLimit({
      legacyHeaders: false,
      limit: rateLimitMaxRequests,
      standardHeaders: true,
      windowMs: rateLimitWindowMs,
    }),
  );
}
