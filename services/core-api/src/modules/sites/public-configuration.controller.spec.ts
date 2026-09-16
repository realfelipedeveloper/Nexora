import { NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import {
  PublicConfigurationController,
  publicConfigurationCacheControl,
} from "./public-configuration.controller.js";
import type { PublicConfigurationService } from "./public-configuration.service.js";

describe("PublicConfigurationController", () => {
  it("returns the public projection without an administrative context", async () => {
    const service = { getSiteConfiguration: vi.fn().mockResolvedValue({ site: { key: "main" } }) };
    const controller = new PublicConfigurationController(
      service as unknown as PublicConfigurationService,
    );

    await expect(controller.get("main")).resolves.toEqual({ site: { key: "main" } });
    expect(service.getSiteConfiguration).toHaveBeenCalledWith("main");
    expect(publicConfigurationCacheControl).toBe(
      "public, max-age=60, s-maxage=300, stale-while-revalidate=60",
    );
  });

  it("uses a bounded not-found response for unavailable public sites", async () => {
    const service = { getSiteConfiguration: vi.fn().mockResolvedValue(null) };
    const controller = new PublicConfigurationController(
      service as unknown as PublicConfigurationService,
    );

    await expect(controller.get("missing")).rejects.toBeInstanceOf(NotFoundException);
  });
});
