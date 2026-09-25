import { describe, expect, it } from "vitest";
import { ContentMetrics } from "./content/content-metrics.js";
import { HealthController } from "./health.controller.js";

describe("HealthController", () => {
  it("reports health", () => {
    const controller = new HealthController(new ContentMetrics());

    expect(controller.health()).toMatchObject({
      service: "core-api",
      status: "ok",
    });
  });

  it("exposes bounded editorial counters", () => {
    const metrics = new ContentMetrics();
    metrics.recordPreconditionFailure();
    metrics.recordPublicRead("detail", "hit");
    metrics.recordNavigationMutation("route_created");
    metrics.recordRoutingResolution("route");
    metrics.recordStateTransition("DRAFT", "PUBLISHED");
    const output = new HealthController(metrics).metrics();

    expect(output).toContain("nexora_content_precondition_failures_total 1");
    expect(output).toContain(
      'nexora_content_state_transitions_total{from="DRAFT",to="PUBLISHED"} 1',
    );
    expect(output).toContain(
      'nexora_public_content_reads_total{operation="detail",outcome="hit"} 1',
    );
    expect(output).toContain('nexora_navigation_mutations_total{operation="route_created"} 1');
    expect(output).toContain('nexora_routing_resolutions_total{result="route"} 1');
  });
});
