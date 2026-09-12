import { Controller, HttpCode, Post, UnauthorizedException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "./app.module.js";
import { configureHttpSecurity } from "./http-security.js";

import type { INestApplication } from "@nestjs/common";

@Controller()
class LoginProbeController {
  @Post("auth/login")
  @HttpCode(401)
  login() {
    throw new UnauthorizedException("Invalid email or password.");
  }
}

describe("core-api HTTP security", () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    configureHttpSecurity(app);
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
  });

  it("sets defensive security headers", async () => {
    const response = await request(app.getHttpServer()).get("/health").expect(200);

    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(response.headers["ratelimit-policy"]).toBeDefined();
  });

  it("rate limits failed login attempts independently", async () => {
    await app.close();
    const moduleRef = await Test.createTestingModule({
      controllers: [LoginProbeController],
    }).compile();
    app = moduleRef.createNestApplication();
    configureHttpSecurity(app, {
      loginRateLimitMaxRequests: 1,
      loginRateLimitWindowMs: 60_000,
      rateLimitMaxRequests: 100,
    });
    await app.init();

    const rejected = await request(app.getHttpServer()).post("/auth/login").expect(401);
    const limited = await request(app.getHttpServer()).post("/auth/login").expect(429);

    expect(rejected.headers["cache-control"]).toBe("no-store");
    expect(limited.headers["cache-control"]).toBe("no-store");
    expect(limited.body).toEqual({
      error: "Too Many Requests",
      message: "Too many login attempts.",
      statusCode: 429,
    });
  });
});
