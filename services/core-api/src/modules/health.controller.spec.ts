import { describe, expect, it } from "vitest";
import { HealthController } from "./health.controller.js";

describe("HealthController", () => {
  it("reports health", () => {
    const controller = new HealthController();

    expect(controller.health()).toMatchObject({
      service: "core-api",
      status: "ok",
    });
  });
});
