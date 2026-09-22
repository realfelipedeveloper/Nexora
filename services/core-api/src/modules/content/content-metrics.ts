import { Injectable } from "@nestjs/common";

type EditorialStatus = "DRAFT" | "PUBLISHED";

@Injectable()
export class ContentMetrics {
  private preconditionFailures = 0;
  private readonly stateTransitions = new Map<string, number>();

  recordPreconditionFailure() {
    this.preconditionFailures += 1;
  }

  recordStateTransition(from: EditorialStatus, to: EditorialStatus) {
    const key = `${from}:${to}`;
    this.stateTransitions.set(key, (this.stateTransitions.get(key) ?? 0) + 1);
  }

  render() {
    const lines = [
      "# Nexora metrics baseline",
      "nexora_core_api_up 1",
      "# TYPE nexora_content_precondition_failures_total counter",
      `nexora_content_precondition_failures_total ${this.preconditionFailures}`,
      "# TYPE nexora_content_state_transitions_total counter",
    ];
    for (const [transition, count] of [...this.stateTransitions.entries()].sort()) {
      const [from, to] = transition.split(":");
      lines.push(`nexora_content_state_transitions_total{from="${from}",to="${to}"} ${count}`);
    }
    return `${lines.join("\n")}\n`;
  }
}
