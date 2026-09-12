import type { INestApplication } from "@nestjs/common";
import rateLimit from "express-rate-limit";
import helmet from "helmet";

type HttpSecurityOptions = {
  loginRateLimitMaxRequests?: number;
  loginRateLimitWindowMs?: number;
  rateLimitMaxRequests?: number;
  rateLimitWindowMs?: number;
};

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value ?? fallback);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function configureHttpSecurity(app: INestApplication, options: HttpSecurityOptions = {}) {
  const rateLimitWindowMs =
    options.rateLimitWindowMs ?? positiveInteger(process.env.HTTP_RATE_LIMIT_WINDOW_MS, 60_000);
  const rateLimitMaxRequests =
    options.rateLimitMaxRequests ?? positiveInteger(process.env.HTTP_RATE_LIMIT_MAX_REQUESTS, 300);
  const loginRateLimitWindowMs =
    options.loginRateLimitWindowMs ??
    positiveInteger(process.env.AUTH_LOGIN_RATE_LIMIT_WINDOW_MS, 300_000);
  const loginRateLimitMaxRequests =
    options.loginRateLimitMaxRequests ??
    positiveInteger(process.env.AUTH_LOGIN_RATE_LIMIT_MAX_REQUESTS, 10);
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
    "/auth",
    (
      _request: unknown,
      response: { setHeader: (name: string, value: string) => void },
      next: () => void,
    ) => {
      response.setHeader("Cache-Control", "no-store");
      next();
    },
  );

  app.use(
    "/auth/login",
    rateLimit({
      legacyHeaders: false,
      limit: loginRateLimitMaxRequests,
      message: {
        error: "Too Many Requests",
        message: "Too many login attempts.",
        statusCode: 429,
      },
      skipSuccessfulRequests: true,
      standardHeaders: true,
      windowMs: loginRateLimitWindowMs,
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
