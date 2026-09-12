import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Matchers, PactV4 } from "@pact-foundation/pact";
import { describe, expect, it } from "vitest";
import { fetchHealth } from "./index.js";

const pactDir = fileURLToPath(new URL("../../../tmp/pacts", import.meta.url));

describe("cms-sdk health contract", () => {
  it("fetches the core API health response", async () => {
    await mkdir(pactDir, { recursive: true });

    const provider = new PactV4({
      consumer: "Nexora CMS SDK",
      provider: "Nexora Core API",
      dir: pactDir,
      logLevel: "warn",
    });

    await provider
      .addInteraction()
      .uponReceiving("a health request")
      .withRequest("GET", "/health")
      .willRespondWith(200, (response) => {
        response.headers({ "content-type": "application/json; charset=utf-8" });
        response.jsonBody({
          service: "core-api",
          status: "ok",
          timestamp: Matchers.iso8601DateTime("2026-09-12T00:00:00Z"),
        });
      })
      .executeTest(async (mockServer) => {
        const health = await fetchHealth(mockServer.url);

        expect(health).toMatchObject({
          service: "core-api",
          status: "ok",
        });
        expect(health.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      });
  });
});
