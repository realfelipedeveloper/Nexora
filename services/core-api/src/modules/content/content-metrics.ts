import { Injectable } from "@nestjs/common";

type EditorialStatus = "DRAFT" | "PUBLISHED";
type PublicContentOperation = "detail" | "list";
type PublicContentOutcome = "hit" | "miss";

@Injectable()
export class ContentMetrics {
  private preconditionFailures = 0;
  private readonly publicReads = new Map<string, number>();
  private readonly stateTransitions = new Map<string, number>();

  recordPreconditionFailure() {
    this.preconditionFailures += 1;
  }

  recordPublicRead(operation: PublicContentOperation, outcome: PublicContentOutcome) {
    const key = `${operation}:${outcome}`;
    this.publicReads.set(key, (this.publicReads.get(key) ?? 0) + 1);
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
      "# TYPE nexora_public_content_reads_total counter",
    ];
    for (const [result, count] of [...this.publicReads.entries()].sort()) {
      const [operation, outcome] = result.split(":");
      lines.push(
        `nexora_public_content_reads_total{operation="${operation}",outcome="${outcome}"} ${count}`,
      );
    }
    lines.push("# TYPE nexora_content_state_transitions_total counter");
    for (const [transition, count] of [...this.stateTransitions.entries()].sort()) {
      const [from, to] = transition.split(":");
      lines.push(`nexora_content_state_transitions_total{from="${from}",to="${to}"} ${count}`);
    }
    return `${lines.join("\n")}\n`;
  }
}
