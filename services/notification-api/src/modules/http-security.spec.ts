import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "./app.module.js";
import { configureHttpSecurity } from "./http-security.js";

import type { INestApplication } from "@nestjs/common";

describe("notification-api HTTP security", () => {
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
    await app.close();
  });

  it("sets defensive security headers", async () => {
    const response = await request(app.getHttpServer()).get("/health").expect(200);

    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(response.headers["ratelimit-policy"]).toBeDefined();
  });
});
